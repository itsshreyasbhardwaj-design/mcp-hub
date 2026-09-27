import {
  type ApprovalRecord,
  type ApprovalStatus,
  type CompatibilityRunRecord,
  type HealthCheckRecord,
  type HealthStatus,
  type Id,
  type IncidentEvidence,
  type IncidentKind,
  type IncidentRecord,
  type IncidentStatus,
  type InvocationRecord,
  type InvocationStatus,
  type Page,
  type PageRequest,
  type PermissionRuleRecord,
  type RiskClass,
  type SecurityFindingRecord,
  type Severity,
  type ValidationFinding,
  type ValidationRunRecord,
  HubError,
  decodeCursor,
  encodeCursor,
  newId,
} from '@mcp-hub/core';
import type { SqlExecutor } from '../driver.js';
import { Params, WhereBuilder } from '../sqlutil.js';
import {
  toApproval,
  toCompatibilityRun,
  toHealthCheck,
  toIncident,
  toInvocation,
  toPermissionRule,
  toSecurityFinding,
  toValidationRun,
} from '../rows.js';

export class GovernanceRepository {
  constructor(private readonly db: SqlExecutor) {}

  // --- Validation ---------------------------------------------------------

  async recordValidationRun(input: {
    organizationId: Id<'organization'>;
    serverId: Id<'server'>;
    versionId: Id<'version'> | null;
    outcome: 'pass' | 'warning' | 'error';
    findings: ValidationFinding[];
    durationMs: number;
    triggeredBy: Id<'user'> | null;
  }): Promise<ValidationRunRecord> {
    const counts = { error: 0, warning: 0, info: 0 };
    for (const finding of input.findings) counts[finding.severity] += 1;

    const runId = newId('validationRun');
    const { rows } = await this.db.query(
      `insert into validation_runs (
         id, organization_id, server_id, version_id, outcome,
         error_count, warning_count, info_count, duration_ms, triggered_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [
        runId,
        input.organizationId,
        input.serverId,
        input.versionId,
        input.outcome,
        counts.error,
        counts.warning,
        counts.info,
        input.durationMs,
        input.triggeredBy,
      ],
    );

    let ordinal = 0;
    for (const finding of input.findings) {
      await this.db.query(
        `insert into validation_findings (id, run_id, severity, rule, location, message, suggestion, ordinal)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          finding.id,
          runId,
          finding.severity,
          finding.rule,
          finding.location,
          finding.message,
          finding.suggestion,
          ordinal++,
        ],
      );
    }

    const row = rows[0];
    if (!row) throw HubError.internal('Failed to record validation run.');
    return { ...toValidationRun(row), findings: input.findings };
  }

  async findValidationRun(
    organizationId: Id<'organization'>,
    runId: Id<'validationRun'>,
  ): Promise<ValidationRunRecord | null> {
    const { rows } = await this.db.query(
      'select * from validation_runs where organization_id = $1 and id = $2',
      [organizationId, runId],
    );
    if (!rows[0]) return null;
    return { ...toValidationRun(rows[0]), findings: await this.listFindings(runId) };
  }

  async listFindings(runId: Id<'validationRun'>): Promise<ValidationFinding[]> {
    const { rows } = await this.db.query(
      'select * from validation_findings where run_id = $1 order by ordinal asc',
      [runId],
    );
    return rows.map((row) => ({
      id: String(row['id']),
      severity: row['severity'] as Severity,
      rule: String(row['rule']),
      location: String(row['location']),
      message: String(row['message']),
      suggestion: (row['suggestion'] as string | null) ?? null,
    }));
  }

  async latestValidationRun(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
  ): Promise<ValidationRunRecord | null> {
    const { rows } = await this.db.query(
      `select * from validation_runs where organization_id = $1 and server_id = $2
        order by created_at desc limit 1`,
      [organizationId, serverId],
    );
    if (!rows[0]) return null;
    return {
      ...toValidationRun(rows[0]),
      findings: await this.listFindings(String(rows[0]['id']) as Id<'validationRun'>),
    };
  }

  async listValidationRuns(
    organizationId: Id<'organization'>,
    serverId: Id<'server'> | null,
    limit: number,
  ): Promise<ValidationRunRecord[]> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('organization_id', organizationId);
    where.eq('server_id', serverId ?? undefined);
    const limitParam = params.add(limit);
    const { rows } = await this.db.query(
      `select * from validation_runs ${where.sql} order by created_at desc limit ${limitParam}`,
      params.all,
    );
    return rows.map(toValidationRun);
  }

  // --- Compatibility ------------------------------------------------------

  async recordCompatibilityRun(run: Omit<CompatibilityRunRecord, 'id' | 'createdAt'>): Promise<CompatibilityRunRecord> {
    const runId = newId('compatibilityRun');
    const { rows } = await this.db.query(
      `insert into compatibility_runs (
         id, organization_id, server_id, version_id, environment_id, suites,
         total, passed, warnings, failed, skipped, duration_ms, triggered_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [
        runId,
        run.organizationId,
        run.serverId,
        run.versionId,
        run.environmentId,
        run.suites,
        run.total,
        run.passed,
        run.warnings,
        run.failed,
        run.skipped,
        run.durationMs,
        run.triggeredBy,
      ],
    );

    let ordinal = 0;
    for (const testCase of run.cases) {
      await this.db.query(
        `insert into compatibility_cases (id, run_id, suite, key, title, outcome, duration_ms, message, evidence, ordinal)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          testCase.id,
          runId,
          testCase.suite,
          testCase.key,
          testCase.title,
          testCase.outcome,
          testCase.durationMs,
          testCase.message,
          testCase.evidence ? JSON.stringify(testCase.evidence) : null,
          ordinal++,
        ],
      );
    }

    const row = rows[0];
    if (!row) throw HubError.internal('Failed to record compatibility run.');
    return { ...toCompatibilityRun(row), cases: run.cases };
  }

  async findCompatibilityRun(
    organizationId: Id<'organization'>,
    runId: Id<'compatibilityRun'>,
  ): Promise<CompatibilityRunRecord | null> {
    const { rows } = await this.db.query(
      'select * from compatibility_runs where organization_id = $1 and id = $2',
      [organizationId, runId],
    );
    if (!rows[0]) return null;
    const { rows: caseRows } = await this.db.query(
      'select * from compatibility_cases where run_id = $1 order by ordinal asc',
      [runId],
    );
    return {
      ...toCompatibilityRun(rows[0]),
      cases: caseRows.map((row) => ({
        id: String(row['id']) as Id<'compatibilityCase'>,
        suite: row['suite'] as CompatibilityRunRecord['suites'][number],
        key: String(row['key']),
        title: String(row['title']),
        outcome: row['outcome'] as 'passed' | 'warning' | 'failed' | 'skipped',
        durationMs: Number(row['duration_ms'] ?? 0),
        message: (row['message'] as string | null) ?? null,
        evidence: (row['evidence'] as Record<string, unknown> | null) ?? null,
      })),
    };
  }

  async listCompatibilityRuns(
    organizationId: Id<'organization'>,
    serverId: Id<'server'> | null,
    limit: number,
  ): Promise<CompatibilityRunRecord[]> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('organization_id', organizationId);
    where.eq('server_id', serverId ?? undefined);
    const limitParam = params.add(limit);
    const { rows } = await this.db.query(
      `select * from compatibility_runs ${where.sql} order by created_at desc limit ${limitParam}`,
      params.all,
    );
    return rows.map(toCompatibilityRun);
  }

  // --- Health -------------------------------------------------------------

  async recordHealthCheck(
    input: Omit<HealthCheckRecord, 'id' | 'checkedAt'> & { checkedAt?: Date },
  ): Promise<HealthCheckRecord> {
    const { rows } = await this.db.query(
      `insert into health_checks (
         id, organization_id, server_id, version_id, status, latency_ms, tool_count,
         initialized, timed_out, error_code, error_message, checked_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [
        newId('healthCheck'),
        input.organizationId,
        input.serverId,
        input.versionId,
        input.status,
        input.latencyMs,
        input.toolCount,
        input.initialized,
        input.timedOut,
        input.errorCode,
        input.errorMessage,
        input.checkedAt ?? new Date(),
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to record health check.');
    return toHealthCheck(row);
  }

  async listHealthChecks(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    options: { since?: Date; limit: number },
  ): Promise<HealthCheckRecord[]> {
    const params = new Params();
    const where = new WhereBuilder(params)
      .eq('organization_id', organizationId)
      .eq('server_id', serverId);
    where.gte('checked_at', options.since);
    const limitParam = params.add(options.limit);
    const { rows } = await this.db.query(
      `select * from health_checks ${where.sql} order by checked_at desc limit ${limitParam}`,
      params.all,
    );
    return rows.map(toHealthCheck);
  }

  /** Uptime and latency summary computed from the stored checks. */
  async healthSummary(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    since: Date,
  ): Promise<{
    checks: number;
    healthy: number;
    failing: number;
    uptimePercent: number | null;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    timeouts: number;
  }> {
    const { rows } = await this.db.query<{
      checks: number;
      healthy: number;
      failing: number;
      timeouts: number;
      avg_latency: number | null;
      p95_latency: number | null;
    }>(
      `select
         count(*)::int as checks,
         count(*) filter (where status = 'healthy')::int as healthy,
         count(*) filter (where status = 'failing')::int as failing,
         count(*) filter (where timed_out)::int as timeouts,
         avg(latency_ms)::float as avg_latency,
         percentile_cont(0.95) within group (order by latency_ms)::float as p95_latency
       from health_checks
       where organization_id = $1 and server_id = $2 and checked_at >= $3`,
      [organizationId, serverId, since],
    );
    const row = rows[0];
    if (!row || row.checks === 0) {
      return {
        checks: 0,
        healthy: 0,
        failing: 0,
        uptimePercent: null,
        avgLatencyMs: null,
        p95LatencyMs: null,
        timeouts: 0,
      };
    }
    return {
      checks: row.checks,
      healthy: row.healthy,
      failing: row.failing,
      timeouts: row.timeouts,
      uptimePercent: Math.round((row.healthy / row.checks) * 10000) / 100,
      avgLatencyMs: row.avg_latency == null ? null : Math.round(row.avg_latency),
      p95LatencyMs: row.p95_latency == null ? null : Math.round(row.p95_latency),
    };
  }

  // --- Incidents ----------------------------------------------------------

  async openIncident(input: {
    organizationId: Id<'organization'>;
    serverId: Id<'server'>;
    kind: IncidentKind;
    title: string;
    evidence: IncidentEvidence[];
  }): Promise<IncidentRecord> {
    const { rows } = await this.db.query(
      `insert into incidents (id, organization_id, server_id, kind, status, title, evidence)
       values ($1,$2,$3,$4,'investigating',$5,$6)
       on conflict (server_id, kind) where status <> 'resolved'
       do update set evidence = excluded.evidence, title = excluded.title, updated_at = now()
       returning *`,
      [
        newId('incident'),
        input.organizationId,
        input.serverId,
        input.kind,
        input.title,
        JSON.stringify(input.evidence),
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to open incident.');
    return toIncident(row);
  }

  async resolveIncident(
    organizationId: Id<'organization'>,
    incidentId: Id<'incident'>,
  ): Promise<IncidentRecord | null> {
    const { rows } = await this.db.query(
      `update incidents set status = 'resolved', resolved_at = now(), updated_at = now()
        where organization_id = $1 and id = $2 and status <> 'resolved'
        returning *`,
      [organizationId, incidentId],
    );
    return rows[0] ? toIncident(rows[0]) : null;
  }

  async resolveOpenIncidents(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    kinds: IncidentKind[],
  ): Promise<number> {
    if (kinds.length === 0) return 0;
    const params = new Params();
    const org = params.add(organizationId);
    const srv = params.add(serverId);
    const placeholders = kinds.map((k) => params.add(k)).join(', ');
    const result = await this.db.query(
      `update incidents set status = 'resolved', resolved_at = now(), updated_at = now()
        where organization_id = ${org} and server_id = ${srv}
          and kind in (${placeholders}) and status <> 'resolved'`,
      params.all,
    );
    return result.rowCount;
  }

  async listIncidents(
    organizationId: Id<'organization'>,
    options: { status?: IncidentStatus[]; serverId?: Id<'server'> | null; limit: number },
  ): Promise<IncidentRecord[]> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('organization_id', organizationId);
    where.in('status', options.status);
    where.eq('server_id', options.serverId ?? undefined);
    const limitParam = params.add(options.limit);
    const { rows } = await this.db.query(
      `select * from incidents ${where.sql} order by started_at desc limit ${limitParam}`,
      params.all,
    );
    return rows.map(toIncident);
  }

  async countOpenIncidents(organizationId: Id<'organization'>): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count from incidents
        where organization_id = $1 and status <> 'resolved'`,
      [organizationId],
    );
    return rows[0]?.count ?? 0;
  }

  // --- Permission rules ---------------------------------------------------

  async createPermissionRule(
    input: Omit<PermissionRuleRecord, 'id' | 'createdAt'>,
  ): Promise<PermissionRuleRecord> {
    const { rows } = await this.db.query(
      `insert into permission_rules (
         id, organization_id, effect, subject_user_id, subject_role, server_id,
         version_id, tool_name, risk_class, environment_id, priority, description, created_by
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [
        newId('permissionRule'),
        input.organizationId,
        input.effect,
        input.subjectUserId,
        input.subjectRole,
        input.serverId,
        input.versionId,
        input.toolName,
        input.riskClass,
        input.environmentId,
        input.priority,
        input.description,
        input.createdBy,
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to create permission rule.');
    return toPermissionRule(row);
  }

  async listPermissionRules(
    organizationId: Id<'organization'>,
  ): Promise<PermissionRuleRecord[]> {
    const { rows } = await this.db.query(
      'select * from permission_rules where organization_id = $1 order by priority desc, created_at asc',
      [organizationId],
    );
    return rows.map(toPermissionRule);
  }

  async deletePermissionRule(
    organizationId: Id<'organization'>,
    ruleId: Id<'permissionRule'>,
  ): Promise<boolean> {
    const result = await this.db.query(
      'delete from permission_rules where organization_id = $1 and id = $2',
      [organizationId, ruleId],
    );
    return result.rowCount > 0;
  }

  // --- Approvals ----------------------------------------------------------

  async createApproval(input: {
    organizationId: Id<'organization'>;
    serverId: Id<'server'>;
    versionId: Id<'version'>;
    toolName: string;
    riskClass: RiskClass;
    argumentsJson: Record<string, unknown>;
    argumentsHash: string;
    reason: string | null;
    requestedBy: Id<'user'>;
    expiresAt: Date;
  }): Promise<ApprovalRecord> {
    const { rows } = await this.db.query(
      `insert into approvals (
         id, organization_id, server_id, version_id, tool_name, risk_class,
         arguments_json, arguments_hash, reason, status, requested_by, expires_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11) returning *`,
      [
        newId('approval'),
        input.organizationId,
        input.serverId,
        input.versionId,
        input.toolName,
        input.riskClass,
        JSON.stringify(input.argumentsJson),
        input.argumentsHash,
        input.reason,
        input.requestedBy,
        input.expiresAt,
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to create approval request.');
    return toApproval(row);
  }

  async findApproval(
    organizationId: Id<'organization'>,
    approvalId: Id<'approval'>,
  ): Promise<ApprovalRecord | null> {
    const { rows } = await this.db.query(
      'select * from approvals where organization_id = $1 and id = $2',
      [organizationId, approvalId],
    );
    return rows[0] ? toApproval(rows[0]) : null;
  }

  /**
   * Finds an approval that authorises exactly this call. Matching on the
   * argument hash is what prevents an approval for benign arguments being
   * replayed against a destructive payload.
   */
  async findUsableApproval(input: {
    organizationId: Id<'organization'>;
    versionId: Id<'version'>;
    toolName: string;
    argumentsHash: string;
    now?: Date;
  }): Promise<ApprovalRecord | null> {
    const { rows } = await this.db.query(
      `select * from approvals
        where organization_id = $1 and version_id = $2 and tool_name = $3
          and arguments_hash = $4 and status = 'approved'
          and consumed_at is null and expires_at > $5
        order by decided_at desc limit 1`,
      [
        input.organizationId,
        input.versionId,
        input.toolName,
        input.argumentsHash,
        input.now ?? new Date(),
      ],
    );
    return rows[0] ? toApproval(rows[0]) : null;
  }

  async decideApproval(input: {
    organizationId: Id<'organization'>;
    approvalId: Id<'approval'>;
    decision: 'approved' | 'denied';
    decidedBy: Id<'user'>;
    reason: string | null;
  }): Promise<ApprovalRecord> {
    const { rows } = await this.db.query(
      `update approvals
          set status = $3, decided_by = $4, decision_reason = $5, decided_at = now()
        where organization_id = $1 and id = $2 and status = 'pending'
        returning *`,
      [
        input.organizationId,
        input.approvalId,
        input.decision,
        input.decidedBy,
        input.reason,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw HubError.conflict('This approval request is no longer pending.', {
        approvalId: input.approvalId,
      });
    }
    return toApproval(row);
  }

  /** Marks an approval as spent. Single-use by design. */
  async consumeApproval(
    organizationId: Id<'organization'>,
    approvalId: Id<'approval'>,
  ): Promise<boolean> {
    const result = await this.db.query(
      `update approvals set status = 'consumed', consumed_at = now()
        where organization_id = $1 and id = $2 and status = 'approved' and consumed_at is null`,
      [organizationId, approvalId],
    );
    return result.rowCount > 0;
  }

  async expireStaleApprovals(now = new Date()): Promise<number> {
    const result = await this.db.query(
      `update approvals set status = 'expired'
        where status in ('pending','approved') and expires_at <= $1`,
      [now],
    );
    return result.rowCount;
  }

  async listApprovals(
    organizationId: Id<'organization'>,
    options: { status?: ApprovalStatus[]; limit: number },
  ): Promise<ApprovalRecord[]> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('organization_id', organizationId);
    where.in('status', options.status);
    const limitParam = params.add(options.limit);
    const { rows } = await this.db.query(
      `select * from approvals ${where.sql} order by created_at desc limit ${limitParam}`,
      params.all,
    );
    return rows.map(toApproval);
  }

  // --- Invocations --------------------------------------------------------

  async recordInvocation(
    input: Omit<InvocationRecord, 'id' | 'createdAt'>,
  ): Promise<InvocationRecord> {
    const { rows } = await this.db.query(
      `insert into tool_invocations (
         id, organization_id, server_id, version_id, environment_id, tool_name, risk_class,
         status, duration_ms, error_code, error_message, request_bytes, response_bytes,
         approval_id, actor_user_id, actor_api_key_id, request_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
      [
        newId('invocation'),
        input.organizationId,
        input.serverId,
        input.versionId,
        input.environmentId,
        input.toolName,
        input.riskClass,
        input.status,
        input.durationMs,
        input.errorCode,
        input.errorMessage,
        input.requestBytes,
        input.responseBytes,
        input.approvalId,
        input.actorUserId,
        input.actorApiKeyId,
        input.requestId,
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to record invocation.');
    return toInvocation(row);
  }

  async listInvocations(
    organizationId: Id<'organization'>,
    filter: {
      serverId?: Id<'server'> | null;
      toolName?: string | null;
      status?: InvocationStatus[];
      since?: Date;
    },
    page: PageRequest,
  ): Promise<Page<InvocationRecord>> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('organization_id', organizationId);
    where.eq('server_id', filter.serverId ?? undefined);
    where.eq('tool_name', filter.toolName ?? undefined);
    where.in('status', filter.status);
    where.gte('created_at', filter.since);
    if (page.cursor) {
      const { sortValue, id } = decodeCursor(page.cursor);
      where.and(`(created_at, id) < (${params.add(new Date(sortValue))}, ${params.add(id)})`);
    }
    const limitParam = params.add(page.limit + 1);
    const { rows } = await this.db.query(
      `select * from tool_invocations ${where.sql}
        order by created_at desc, id desc limit ${limitParam}`,
      params.all,
    );
    const hasMore = rows.length > page.limit;
    const data = rows.slice(0, page.limit).map(toInvocation);
    const last = data[data.length - 1];
    return {
      data,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  // --- Security findings --------------------------------------------------

  async upsertSecurityFinding(input: {
    organizationId: Id<'organization'>;
    serverId: Id<'server'>;
    versionId: Id<'version'> | null;
    severity: Severity;
    rule: string;
    title: string;
    detail: string;
    excerpt: string | null;
    location: string;
  }): Promise<SecurityFindingRecord> {
    const { rows } = await this.db.query(
      `insert into security_findings (
         id, organization_id, server_id, version_id, severity, rule, title, detail, excerpt, location
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (server_id, coalesce(version_id, ''), rule, location)
       do update set severity = excluded.severity, title = excluded.title,
                     detail = excluded.detail, excerpt = excluded.excerpt
       returning *`,
      [
        newId('finding'),
        input.organizationId,
        input.serverId,
        input.versionId,
        input.severity,
        input.rule,
        input.title,
        input.detail,
        input.excerpt,
        input.location,
      ],
    );
    const row = rows[0];
    if (!row) throw HubError.internal('Failed to record security finding.');
    return toSecurityFinding(row);
  }

  async listSecurityFindings(
    organizationId: Id<'organization'>,
    options: { serverId?: Id<'server'> | null; severity?: Severity[]; limit: number },
  ): Promise<SecurityFindingRecord[]> {
    const params = new Params();
    const where = new WhereBuilder(params).eq('organization_id', organizationId);
    where.eq('server_id', options.serverId ?? undefined);
    where.in('severity', options.severity);
    const limitParam = params.add(options.limit);
    const { rows } = await this.db.query(
      `select * from security_findings ${where.sql}
        order by case severity when 'error' then 0 when 'warning' then 1 else 2 end,
                 created_at desc
        limit ${limitParam}`,
      params.all,
    );
    return rows.map(toSecurityFinding);
  }

  async clearSecurityFindings(
    organizationId: Id<'organization'>,
    serverId: Id<'server'>,
    versionId: Id<'version'> | null,
  ): Promise<void> {
    await this.db.query(
      `delete from security_findings
        where organization_id = $1 and server_id = $2
          and coalesce(version_id, '') = coalesce($3, '')`,
      [organizationId, serverId, versionId],
    );
  }

  async countSecurityFindings(
    organizationId: Id<'organization'>,
  ): Promise<{ total: number; errors: number }> {
    const { rows } = await this.db.query<{ total: number; errors: number }>(
      `select count(*)::int as total,
              count(*) filter (where severity = 'error')::int as errors
         from security_findings where organization_id = $1 and acknowledged_at is null`,
      [organizationId],
    );
    return { total: rows[0]?.total ?? 0, errors: rows[0]?.errors ?? 0 };
  }

  async healthStatusFor(
    organizationId: Id<'organization'>,
    serverIds: readonly Id<'server'>[],
  ): Promise<Map<string, HealthStatus>> {
    if (serverIds.length === 0) return new Map();
    const params = new Params();
    const org = params.add(organizationId);
    const placeholders = serverIds.map((id) => params.add(id)).join(', ');
    const { rows } = await this.db.query<{ id: string; health_status: HealthStatus }>(
      `select id, health_status from servers
        where organization_id = ${org} and id in (${placeholders})`,
      params.all,
    );
    return new Map(rows.map((row) => [row.id, row.health_status]));
  }
}
