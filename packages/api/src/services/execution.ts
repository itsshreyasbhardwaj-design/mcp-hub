import {
  type ApprovalRecord,
  type Id,
  type InvocationStatus,
  type Principal,
  type RiskClass,
  HubError,
  SENSITIVE_RISK_CLASSES,
  effectiveRisk,
  truncate,
} from '@mcp-hub/core';
import { currentRequestId, redact } from '@mcp-hub/observability';
import { withMcpSession, type CallToolResult } from '@mcp-hub/mcp-client';
import {
  assertPayloadWithinLimit,
  assertStructureWithinLimits,
  byteLength,
} from '@mcp-hub/security';
import {
  evaluate,
  evaluateApproval,
  hashArguments,
  type PermissionDecision,
} from '@mcp-hub/permissions';
import type { AppContext } from '../context.js';
import { requireScope } from '../auth/resolve.js';
import { audit, emit } from './audit.js';
import { resolveSecrets } from './secrets.js';
import { resolveTransport } from './discovery.js';

export interface ExecuteToolInput {
  versionId: Id<'version'>;
  toolName: string;
  arguments: unknown;
  environmentId?: Id<'environment'> | null;
  /**
   * Explicit confirmation that the caller understands the tool is sensitive.
   * Required for DESTRUCTIVE/CREDENTIAL/ADMIN/UNKNOWN tools even when a
   * permission rule allows them outright.
   */
  acknowledgeRisk?: boolean;
  /** An approval the caller believes authorises this exact call. */
  approvalId?: Id<'approval'> | null;
}

export interface ExecuteToolResult {
  status: InvocationStatus;
  invocationId: Id<'invocation'>;
  durationMs: number;
  riskClass: RiskClass;
  decision: { effect: PermissionDecision['effect']; reason: string; source: string };
  result: CallToolResult | null;
  error: { code: string; message: string } | null;
  requestBytes: number;
  responseBytes: number;
  approvalId: Id<'approval'> | null;
}

/**
 * The single path through which a tool is ever invoked.
 *
 * Order matters and is enforced here rather than in any caller:
 *
 *   scope → permission rules → sensitive-tool acknowledgement → approval →
 *   payload limits → transport policy → execution → audit
 *
 * The playground, the API and the SDK all land on this function. The browser
 * hides controls a user cannot use, but nothing in the browser is trusted:
 * the decision below is recomputed for every call.
 */
export async function executeTool(
  context: AppContext,
  principal: Principal,
  input: ExecuteToolInput,
): Promise<ExecuteToolResult> {
  requireScope(principal, 'tools:execute');

  const version = await context.repositories.registry.findVersionById(
    principal.organizationId,
    input.versionId,
  );
  if (!version) throw new HubError('VERSION_NOT_FOUND', 'The requested version does not exist.');

  const tool = await context.repositories.registry.findTool(
    principal.organizationId,
    input.versionId,
    input.toolName,
  );
  if (!tool) {
    throw new HubError(
      'TOOL_NOT_FOUND',
      `This version does not expose a tool named "${input.toolName}".`,
    );
  }

  const riskClass = effectiveRisk(tool);
  const rules = await context.repositories.governance.listPermissionRules(principal.organizationId);
  const decision = evaluate(
    {
      subject: {
        userId: principal.userId,
        role: principal.role,
        apiKeyId: principal.apiKeyId ?? null,
        scopes: principal.scopes,
      },
      serverId: version.serverId,
      versionId: version.id,
      toolName: tool.name,
      riskClass,
      environmentId: input.environmentId ?? null,
    },
    rules,
  );

  const requestBytes = byteLength(input.arguments);

  if (decision.effect === 'deny') {
    return recordRefusal(context, principal, {
      version,
      tool: tool.name,
      riskClass,
      decision,
      requestBytes,
      status: 'denied',
      errorCode: 'PERMISSION_DENIED',
      message: decision.reason,
      environmentId: input.environmentId ?? null,
    });
  }

  // A rule may allow a destructive tool, but a human still has to say so on
  // the way past. This is a second, independent gate, not a UI nicety.
  if (SENSITIVE_RISK_CLASSES.includes(riskClass) && input.acknowledgeRisk !== true) {
    return recordRefusal(context, principal, {
      version,
      tool: tool.name,
      riskClass,
      decision,
      requestBytes,
      status: 'blocked',
      errorCode: 'CONFIRMATION_REQUIRED',
      message: `"${tool.name}" is classified ${riskClass}. Re-send with acknowledgeRisk=true to confirm.`,
      environmentId: input.environmentId ?? null,
    });
  }

  const argumentsHash = hashArguments(input.arguments);
  let approval: ApprovalRecord | null = null;
  if (decision.effect === 'require_approval') {
    approval = input.approvalId
      ? await context.repositories.governance.findApproval(
          principal.organizationId,
          input.approvalId,
        )
      : await context.repositories.governance.findUsableApproval({
          organizationId: principal.organizationId,
          versionId: version.id,
          toolName: tool.name,
          argumentsHash,
        });

    const check = evaluateApproval({
      required: true,
      approval,
      expectedArgumentsHash: argumentsHash,
      toolName: tool.name,
    });
    if (check.status !== 'satisfied') {
      return recordRefusal(context, principal, {
        version,
        tool: tool.name,
        riskClass,
        decision,
        requestBytes,
        status: 'denied',
        errorCode: 'APPROVAL_REQUIRED',
        message: check.reason,
        environmentId: input.environmentId ?? null,
      });
    }
  }

  assertStructureWithinLimits(input.arguments);
  assertPayloadWithinLimit(
    input.arguments,
    context.config.security.maxToolPayloadBytes,
    'Tool arguments',
  );

  const transport = await resolveTransport(
    context,
    principal.organizationId,
    version,
    input.environmentId ?? null,
  );
  const secrets = await resolveSecrets(
    context,
    principal.organizationId,
    version.serverId,
    input.environmentId ?? null,
  );

  const started = performance.now();
  let status: InvocationStatus = 'success';
  let result: CallToolResult | null = null;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    result = await withMcpSession(
      { transport, secrets, clientInfo: { name: 'mcp-hub-playground', version: '0.1.0' } },
      async (client) => client.callTool(tool.name, input.arguments),
    );
    if (result.isError) status = 'error';
  } catch (err) {
    const hubError = err instanceof HubError ? err : null;
    status = hubError?.code === 'UPSTREAM_TIMEOUT' ? 'timeout' : 'error';
    errorCode = hubError?.code ?? 'UPSTREAM_ERROR';
    errorMessage = truncate(err instanceof Error ? err.message : String(err), 500);
  }

  const durationMs = Math.round(performance.now() - started);
  const responseBytes = result ? byteLength(result) : 0;

  // Approvals authorise exactly one execution, successful or not: a failed
  // destructive call must not leave a reusable grant behind.
  if (approval) {
    await context.repositories.governance.consumeApproval(principal.organizationId, approval.id);
  }

  const invocation = await context.repositories.governance.recordInvocation({
    organizationId: principal.organizationId,
    serverId: version.serverId,
    versionId: version.id,
    environmentId: input.environmentId ?? null,
    toolName: tool.name,
    riskClass,
    status,
    durationMs,
    errorCode,
    errorMessage,
    requestBytes,
    responseBytes,
    approvalId: approval?.id ?? null,
    actorUserId: principal.userId,
    actorApiKeyId: principal.apiKeyId ?? null,
    requestId: currentRequestId(),
  });

  await audit(context, principal, {
    action: 'tool.invoked',
    resourceType: 'tool',
    resourceId: `${version.id}:${tool.name}`,
    result: status === 'success' ? 'allowed' : 'error',
    metadata: {
      riskClass,
      status,
      durationMs,
      approvalId: approval?.id ?? null,
      decision: decision.effect,
    },
  });
  await emit(context, principal, {
    type: 'tool.invoked',
    serverId: version.serverId,
    versionId: version.id,
    toolName: tool.name,
    environmentId: input.environmentId ?? null,
    value: durationMs,
    status,
  });

  return {
    status,
    invocationId: invocation.id,
    durationMs,
    riskClass,
    decision: { effect: decision.effect, reason: decision.reason, source: decision.source },
    // Tool output is untrusted; it is redacted before it reaches a client.
    result: result ? (redact(result) as CallToolResult) : null,
    error: errorCode ? { code: errorCode, message: errorMessage ?? 'The tool call failed.' } : null,
    requestBytes,
    responseBytes,
    approvalId: approval?.id ?? null,
  };
}

async function recordRefusal(
  context: AppContext,
  principal: Principal,
  input: {
    version: { id: Id<'version'>; serverId: Id<'server'> };
    tool: string;
    riskClass: RiskClass;
    decision: PermissionDecision;
    requestBytes: number;
    status: 'denied' | 'blocked';
    errorCode: string;
    message: string;
    environmentId: Id<'environment'> | null;
  },
): Promise<ExecuteToolResult> {
  const invocation = await context.repositories.governance.recordInvocation({
    organizationId: principal.organizationId,
    serverId: input.version.serverId,
    versionId: input.version.id,
    environmentId: input.environmentId,
    toolName: input.tool,
    riskClass: input.riskClass,
    status: input.status,
    durationMs: 0,
    errorCode: input.errorCode,
    errorMessage: input.message,
    requestBytes: input.requestBytes,
    responseBytes: 0,
    approvalId: null,
    actorUserId: principal.userId,
    actorApiKeyId: principal.apiKeyId ?? null,
    requestId: currentRequestId(),
  });

  await audit(context, principal, {
    action: 'tool.denied',
    resourceType: 'tool',
    resourceId: `${input.version.id}:${input.tool}`,
    result: 'denied',
    metadata: {
      riskClass: input.riskClass,
      reason: input.message,
      effect: input.decision.effect,
      matchedRule: input.decision.matchedRule?.id ?? null,
    },
  });
  await emit(context, principal, {
    type: 'permission.denied',
    serverId: input.version.serverId,
    versionId: input.version.id,
    toolName: input.tool,
    status: input.errorCode,
  });

  return {
    status: input.status,
    invocationId: invocation.id,
    durationMs: 0,
    riskClass: input.riskClass,
    decision: {
      effect: input.decision.effect,
      reason: input.decision.reason,
      source: input.decision.source,
    },
    result: null,
    error: { code: input.errorCode, message: input.message },
    requestBytes: input.requestBytes,
    responseBytes: 0,
    approvalId: null,
  };
}

/**
 * Answers "what would happen if I ran this?" without running it. Powers the
 * playground's pre-flight banner and the permissions preview.
 */
export async function previewExecution(
  context: AppContext,
  principal: Principal,
  input: { versionId: Id<'version'>; toolName: string; environmentId?: Id<'environment'> | null },
): Promise<{
  riskClass: RiskClass;
  decision: PermissionDecision;
  requiresAcknowledgement: boolean;
}> {
  requireScope(principal, 'tools:read');
  const tool = await context.repositories.registry.findTool(
    principal.organizationId,
    input.versionId,
    input.toolName,
  );
  if (!tool) throw new HubError('TOOL_NOT_FOUND', 'That tool does not exist on this version.');

  const riskClass = effectiveRisk(tool);
  const rules = await context.repositories.governance.listPermissionRules(principal.organizationId);
  const decision = evaluate(
    {
      subject: {
        userId: principal.userId,
        role: principal.role,
        apiKeyId: principal.apiKeyId ?? null,
        scopes: principal.scopes,
      },
      serverId: tool.serverId,
      versionId: input.versionId,
      toolName: tool.name,
      riskClass,
      environmentId: input.environmentId ?? null,
    },
    rules,
  );

  return {
    riskClass,
    decision,
    requiresAcknowledgement: SENSITIVE_RISK_CLASSES.includes(riskClass),
  };
}
