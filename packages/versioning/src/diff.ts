import { type VersionChange, type VersionDiff, fingerprint } from '@mcp-hub/core';
import { diffSchemas } from './schema-diff.js';
import type { CapabilitySnapshot, SnapshotTool } from './snapshot.js';

/**
 * Compares two capability snapshots and produces a structured change report.
 *
 * Renames are inferred rather than declared: MCP gives no rename signal, so a
 * tool that disappears and one that appears with an identical input-schema
 * fingerprint are treated as the same tool renamed. The inference is reported
 * as such, and is still marked breaking, because callers of the old name break
 * either way.
 */
export function diffVersions(before: CapabilitySnapshot, after: CapabilitySnapshot): VersionDiff {
  const changes: VersionChange[] = [];

  const beforeTools = new Map(before.tools.map((tool) => [tool.name, tool]));
  const afterTools = new Map(after.tools.map((tool) => [tool.name, tool]));

  const removedNames = [...beforeTools.keys()].filter((name) => !afterTools.has(name));
  const addedNames = [...afterTools.keys()].filter((name) => !beforeTools.has(name));
  const renames = inferRenames(removedNames, addedNames, beforeTools, afterTools);

  const renamedFrom = new Set(renames.map((r) => r.from));
  const renamedTo = new Set(renames.map((r) => r.to));

  for (const { from, to } of renames) {
    const oldTool = beforeTools.get(from);
    const newTool = afterTools.get(to);
    changes.push({
      kind: 'tool_renamed',
      path: `tools.${from}`,
      subject: `${from} → ${to}`,
      before: from,
      after: to,
      breaking: true,
      rule: 'tool.renamed',
      detail:
        `"${from}" appears to have been renamed to "${to}" (identical input schema). ` +
        'Callers using the old name will fail.',
    });
    if (oldTool && newTool) {
      changes.push(...compareToolBodies(oldTool, newTool, to));
    }
  }

  for (const name of removedNames) {
    if (renamedFrom.has(name)) continue;
    changes.push({
      kind: 'tool_removed',
      path: `tools.${name}`,
      subject: name,
      before: name,
      after: null,
      breaking: true,
      rule: 'tool.removed',
      detail: `Tool "${name}" no longer exists. Any client calling it will fail.`,
    });
  }

  for (const name of addedNames) {
    if (renamedTo.has(name)) continue;
    const tool = afterTools.get(name);
    changes.push({
      kind: 'tool_added',
      path: `tools.${name}`,
      subject: name,
      before: null,
      after: name,
      breaking: false,
      rule: 'tool.added',
      detail: `Tool "${name}" was added${tool ? ` (${tool.riskClass})` : ''}.`,
    });
  }

  for (const [name, beforeTool] of beforeTools) {
    const afterTool = afterTools.get(name);
    if (!afterTool) continue;
    changes.push(...compareToolBodies(beforeTool, afterTool, name));
  }

  changes.push(...diffResources(before, after));
  changes.push(...diffPrompts(before, after));
  changes.push(...diffCapabilities(before, after));

  const toolsAdded = changes.filter((c) => c.kind === 'tool_added').length;
  const toolsRemoved = changes.filter((c) => c.kind === 'tool_removed').length;
  const toolsRenamed = changes.filter((c) => c.kind === 'tool_renamed').length;
  const schemasChanged = new Set(
    changes.filter((c) => c.kind === 'schema_changed').map((c) => c.subject),
  ).size;

  // Most severe first, so a reviewer sees the breaking changes immediately.
  const kindOrder: Record<string, number> = {
    tool_removed: 0,
    tool_renamed: 1,
    schema_changed: 2,
    capability_changed: 3,
    risk_changed: 4,
    tool_added: 5,
  };
  changes.sort(
    (a, b) =>
      Number(b.breaking) - Number(a.breaking) ||
      (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) ||
      a.path.localeCompare(b.path),
  );

  return {
    fromVersion: before.version,
    toVersion: after.version,
    toolsAdded,
    toolsRemoved,
    toolsRenamed,
    schemasChanged,
    breakingChanges: changes.filter((c) => c.breaking).length,
    changes,
  };
}

function compareToolBodies(
  before: SnapshotTool,
  after: SnapshotTool,
  subject: string,
): VersionChange[] {
  const changes: VersionChange[] = [];

  for (const schemaChange of diffSchemas(
    before.inputSchema,
    after.inputSchema,
    `tools.${subject}.inputSchema`,
  )) {
    if (schemaChange.kind === 'description-changed') {
      changes.push({
        kind: 'description_changed',
        path: schemaChange.path,
        subject,
        before: schemaChange.before,
        after: schemaChange.after,
        breaking: false,
        rule: schemaChange.rule,
        detail: schemaChange.detail,
      });
      continue;
    }
    changes.push({
      kind: 'schema_changed',
      path: schemaChange.path,
      subject,
      before: schemaChange.before,
      after: schemaChange.after,
      breaking: schemaChange.breaking,
      rule: schemaChange.rule,
      detail: schemaChange.detail,
    });
  }

  if (before.outputSchema || after.outputSchema) {
    for (const schemaChange of diffSchemas(
      before.outputSchema,
      after.outputSchema,
      `tools.${subject}.outputSchema`,
    )) {
      changes.push({
        kind: 'schema_changed',
        path: schemaChange.path,
        subject,
        before: schemaChange.before,
        after: schemaChange.after,
        // An output-schema change breaks consumers rather than callers, so it
        // is reported but not counted as a call-breaking change.
        breaking: false,
        rule: `output.${schemaChange.rule}`,
        detail: `Output schema: ${schemaChange.detail}`,
      });
    }
  }

  if ((before.description ?? '') !== (after.description ?? '')) {
    changes.push({
      kind: 'description_changed',
      path: `tools.${subject}.description`,
      subject,
      before: before.description,
      after: after.description,
      breaking: false,
      rule: 'tool.description-changed',
      detail: 'The tool description changed. Model tool-selection behaviour may change with it.',
    });
  }

  if (before.riskClass !== after.riskClass) {
    changes.push({
      kind: 'risk_changed',
      path: `tools.${subject}.riskClass`,
      subject,
      before: before.riskClass,
      after: after.riskClass,
      breaking: false,
      rule: 'tool.risk-changed',
      detail:
        `Risk classification moved from ${before.riskClass} to ${after.riskClass}. ` +
        'Permission rules written against the old class may no longer apply.',
    });
  }

  return changes;
}

function inferRenames(
  removed: string[],
  added: string[],
  beforeTools: Map<string, SnapshotTool>,
  afterTools: Map<string, SnapshotTool>,
): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  const availableAdded = new Set(added);

  for (const from of removed) {
    const oldTool = beforeTools.get(from);
    if (!oldTool) continue;
    const oldFingerprint = fingerprint(oldTool.inputSchema);
    for (const to of availableAdded) {
      const newTool = afterTools.get(to);
      if (!newTool) continue;
      if (fingerprint(newTool.inputSchema) !== oldFingerprint) continue;
      pairs.push({ from, to });
      availableAdded.delete(to);
      break;
    }
  }
  return pairs;
}

function diffResources(before: CapabilitySnapshot, after: CapabilitySnapshot): VersionChange[] {
  const changes: VersionChange[] = [];
  const beforeUris = new Set(before.resources.map((r) => r.uri));
  const afterUris = new Set(after.resources.map((r) => r.uri));

  for (const uri of beforeUris) {
    if (afterUris.has(uri)) continue;
    changes.push({
      kind: 'resource_removed',
      path: `resources.${uri}`,
      subject: uri,
      before: uri,
      after: null,
      breaking: true,
      rule: 'resource.removed',
      detail: `Resource "${uri}" is no longer exposed.`,
    });
  }
  for (const uri of afterUris) {
    if (beforeUris.has(uri)) continue;
    changes.push({
      kind: 'resource_added',
      path: `resources.${uri}`,
      subject: uri,
      before: null,
      after: uri,
      breaking: false,
      rule: 'resource.added',
      detail: `Resource "${uri}" was added.`,
    });
  }
  return changes;
}

function diffPrompts(before: CapabilitySnapshot, after: CapabilitySnapshot): VersionChange[] {
  const changes: VersionChange[] = [];
  const beforeNames = new Map(before.prompts.map((p) => [p.name, p]));
  const afterNames = new Map(after.prompts.map((p) => [p.name, p]));

  for (const [name] of beforeNames) {
    if (afterNames.has(name)) continue;
    changes.push({
      kind: 'prompt_removed',
      path: `prompts.${name}`,
      subject: name,
      before: name,
      after: null,
      breaking: true,
      rule: 'prompt.removed',
      detail: `Prompt "${name}" is no longer exposed.`,
    });
  }
  for (const [name, prompt] of afterNames) {
    const previous = beforeNames.get(name);
    if (!previous) {
      changes.push({
        kind: 'prompt_added',
        path: `prompts.${name}`,
        subject: name,
        before: null,
        after: name,
        breaking: false,
        rule: 'prompt.added',
        detail: `Prompt "${name}" was added.`,
      });
      continue;
    }
    const beforeRequired = new Set(previous.arguments.filter((a) => a.required).map((a) => a.name));
    const afterRequired = new Set(prompt.arguments.filter((a) => a.required).map((a) => a.name));
    for (const argument of afterRequired) {
      if (beforeRequired.has(argument)) continue;
      changes.push({
        kind: 'schema_changed',
        path: `prompts.${name}.arguments.${argument}`,
        subject: name,
        before: null,
        after: argument,
        breaking: true,
        rule: 'prompt.required-argument-added',
        detail: `Prompt "${name}" now requires "${argument}".`,
      });
    }
  }
  return changes;
}

function diffCapabilities(before: CapabilitySnapshot, after: CapabilitySnapshot): VersionChange[] {
  const changes: VersionChange[] = [];
  const beforeKeys = new Set(Object.keys(before.capabilities ?? {}));
  const afterKeys = new Set(Object.keys(after.capabilities ?? {}));

  for (const key of beforeKeys) {
    if (afterKeys.has(key)) continue;
    changes.push({
      kind: 'capability_changed',
      path: `capabilities.${key}`,
      subject: key,
      before: key,
      after: null,
      breaking: true,
      rule: 'capability.removed',
      detail: `The server no longer advertises the "${key}" capability.`,
    });
  }
  for (const key of afterKeys) {
    if (beforeKeys.has(key)) continue;
    changes.push({
      kind: 'capability_changed',
      path: `capabilities.${key}`,
      subject: key,
      before: null,
      after: key,
      breaking: false,
      rule: 'capability.added',
      detail: `The server now advertises the "${key}" capability.`,
    });
  }

  if (before.protocolVersion !== after.protocolVersion) {
    changes.push({
      kind: 'capability_changed',
      path: 'protocolVersion',
      subject: 'protocolVersion',
      before: before.protocolVersion,
      after: after.protocolVersion,
      breaking: false,
      rule: 'capability.protocol-version-changed',
      detail: `Protocol revision moved from ${before.protocolVersion ?? 'unknown'} to ${after.protocolVersion ?? 'unknown'}.`,
    });
  }
  return changes;
}

/** Human-readable one-line summary, used in headers and notifications. */
export function summarizeDiff(diff: VersionDiff): string {
  const parts: string[] = [];
  if (diff.toolsAdded) parts.push(`+${diff.toolsAdded} tool${diff.toolsAdded === 1 ? '' : 's'}`);
  if (diff.toolsRemoved)
    parts.push(`-${diff.toolsRemoved} tool${diff.toolsRemoved === 1 ? '' : 's'}`);
  if (diff.toolsRenamed) parts.push(`${diff.toolsRenamed} renamed`);
  if (diff.schemasChanged)
    parts.push(`~${diff.schemasChanged} schema${diff.schemasChanged === 1 ? '' : 's'} changed`);
  if (parts.length === 0) return 'No capability changes.';
  return parts.join(', ') + (diff.breakingChanges > 0 ? ` (${diff.breakingChanges} breaking)` : '');
}
