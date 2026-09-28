import { type Id, truncate } from '@mcp-hub/core';
import { getConfig } from '@mcp-hub/config';
import { fenceUntrusted } from '@mcp-hub/security';
import type {
  AnalyticsRepository,
  GovernanceRepository,
  RegistryRepository,
  SearchRepository,
} from '@mcp-hub/database';
import { detectIntent, type AssistantIntent, type DetectedIntent } from './intent.js';
import { selectProvider, type LlmProvider } from './provider.js';

export interface EvidenceItem {
  label: string;
  value: string;
  /** Where the number came from, so the UI can deep-link to it. */
  source: string;
  href?: string | null;
}

export interface AssistantAnswer {
  question: string;
  intent: AssistantIntent;
  /** Empty when the data did not support an answer. */
  answer: string;
  evidence: EvidenceItem[];
  /** True when there was not enough data; `answer` says so explicitly. */
  insufficientEvidence: boolean;
  provider: string;
  model: string | null;
  deterministic: boolean;
  durationMs: number;
}

export interface AssistantRepositories {
  registry: RegistryRepository;
  governance: GovernanceRepository;
  analytics: AnalyticsRepository;
  search: SearchRepository;
}

export interface AskOptions {
  organizationId: Id<'organization'>;
  question: string;
  repositories: AssistantRepositories;
  provider?: LlmProvider;
  /** Trigram availability, forwarded to the search query. */
  trigram?: boolean;
}

const INSUFFICIENT = 'Insufficient evidence to answer this from the data MCP Hub has recorded.';

/**
 * The assistant pipeline.
 *
 *   question → intent → a fixed, authorised query → evidence → prose
 *
 * Two properties are structural rather than prompted:
 *
 *  1. The model never reaches the database. Intent selects one of a small set
 *     of parameterised queries, each already scoped to the caller's
 *     organization, and only their results are passed on.
 *  2. With no evidence, the pipeline returns "insufficient evidence" and never
 *     calls the model at all, so there is nothing for it to invent.
 */
export async function ask(options: AskOptions): Promise<AssistantAnswer> {
  const started = performance.now();
  const question = truncate(options.question.trim(), 500);
  const detected = detectIntent(question);
  const provider = options.provider ?? selectProvider(getConfig());

  const evidence = await collectEvidence(detected, options);

  if (detected.intent === 'unsupported') {
    return {
      question,
      intent: detected.intent,
      answer:
        'I can answer questions about server health, version changes, tool schemas, ' +
        'compatibility results, usage statistics, and finding servers in this registry.',
      evidence: [],
      insufficientEvidence: true,
      provider: provider.name,
      model: null,
      deterministic: true,
      durationMs: Math.round(performance.now() - started),
    };
  }

  if (evidence.length === 0) {
    return {
      question,
      intent: detected.intent,
      answer: INSUFFICIENT,
      evidence: [],
      insufficientEvidence: true,
      provider: provider.name,
      model: null,
      deterministic: true,
      durationMs: Math.round(performance.now() - started),
    };
  }

  const summary = renderEvidence(detected.intent, evidence);
  const completion = await provider
    .complete({
      messages: [
        {
          role: 'system',
          content: [
            'You explain MCP infrastructure to an engineer.',
            'Use only the evidence provided. Never state a cause the evidence does not show.',
            'If the evidence is insufficient, say exactly: "' + INSUFFICIENT + '"',
            'Be concise: at most four sentences. Do not repeat the evidence list verbatim.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Question: ${question}\n\n${fenceUntrusted('mcp-hub-evidence', summary)}`,
        },
      ],
      maxTokens: 400,
      temperature: 0.1,
    })
    .catch(() => ({ text: summary, provider: provider.name, model: null, deterministic: true }));

  return {
    question,
    intent: detected.intent,
    answer: completion.text.trim() || summary,
    evidence,
    insufficientEvidence: false,
    provider: completion.provider,
    model: completion.model,
    deterministic: completion.deterministic,
    durationMs: Math.round(performance.now() - started),
  };
}

async function collectEvidence(
  detected: DetectedIntent,
  options: AskOptions,
): Promise<EvidenceItem[]> {
  const { organizationId, repositories } = options;

  switch (detected.intent) {
    case 'server_health': {
      const server = await resolveServer(detected, options);
      if (!server) return [];
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [summary, checks, incidents] = await Promise.all([
        repositories.governance.healthSummary(organizationId, server.id, since),
        repositories.governance.listHealthChecks(organizationId, server.id, { since, limit: 20 }),
        repositories.governance.listIncidents(organizationId, {
          serverId: server.id,
          status: ['investigating', 'ongoing'],
          limit: 5,
        }),
      ]);
      if (summary.checks === 0) return [];

      const items: EvidenceItem[] = [
        {
          label: 'Server',
          value: `${server.name} (${server.healthStatus})`,
          source: 'servers',
          href: `/servers/${server.slug}`,
        },
        {
          label: 'Health checks in the last 24h',
          value: String(summary.checks),
          source: 'health_checks',
        },
        { label: 'Uptime', value: `${summary.uptimePercent ?? 0}%`, source: 'health_checks' },
      ];
      if (summary.p95LatencyMs != null) {
        items.push({
          label: 'p95 latency',
          value: `${summary.p95LatencyMs}ms`,
          source: 'health_checks',
        });
      }
      if (summary.timeouts > 0) {
        items.push({ label: 'Timeouts', value: String(summary.timeouts), source: 'health_checks' });
      }
      const lastError = checks.find((check) => check.errorMessage);
      if (lastError?.errorMessage) {
        items.push({
          label: 'Most recent error',
          value: truncate(lastError.errorMessage, 160),
          source: 'health_checks',
        });
      }
      for (const incident of incidents) {
        items.push({
          label: `Open incident (${incident.kind})`,
          value: incident.title,
          source: 'incidents',
        });
      }
      return items;
    }

    case 'version_changes': {
      const server = await resolveServer(detected, options);
      if (!server) return [];
      const versions = await repositories.registry.listVersions(organizationId, server.id);
      if (versions.length < 2) return [];
      const to = versions.find((v) => v.version === detected.entities.toVersion) ?? versions[0];
      const from = versions.find((v) => v.version === detected.entities.fromVersion) ?? versions[1];
      if (!to || !from || to.id === from.id) return [];

      const [fromTools, toTools] = await Promise.all([
        repositories.registry.listTools(organizationId, from.id),
        repositories.registry.listTools(organizationId, to.id),
      ]);
      const fromNames = new Set(fromTools.map((t) => t.name));
      const toNames = new Set(toTools.map((t) => t.name));
      const added = [...toNames].filter((n) => !fromNames.has(n));
      const removed = [...fromNames].filter((n) => !toNames.has(n));

      const items: EvidenceItem[] = [
        {
          label: 'Comparing',
          value: `${from.version} → ${to.version}`,
          source: 'server_versions',
          href: `/servers/${server.slug}/versions`,
        },
        { label: 'Tools before', value: String(fromTools.length), source: 'server_tools' },
        { label: 'Tools after', value: String(toTools.length), source: 'server_tools' },
      ];
      if (added.length)
        items.push({ label: 'Added tools', value: added.join(', '), source: 'server_tools' });
      if (removed.length)
        items.push({ label: 'Removed tools', value: removed.join(', '), source: 'server_tools' });
      return items;
    }

    case 'find_servers': {
      const text = detected.entities.searchText ?? detected.entities.serverRef ?? '';
      if (text.trim().length < 2) return [];
      const { hits } = await repositories.search.search({
        organizationId,
        query: text,
        includePublic: true,
        limit: 8,
        offset: 0,
        trigram: options.trigram ?? false,
      });
      return hits.map((hit) => ({
        label: `${hit.docType}: ${hit.title}`,
        value: truncate(hit.subtitle ?? hit.body, 120) || '(no description)',
        source: 'search_documents',
        href:
          hit.docType === 'server'
            ? `/servers/${hit.serverId}`
            : `/tools?q=${encodeURIComponent(hit.title)}`,
      }));
    }

    case 'explain_tool': {
      const toolName = detected.entities.toolName ?? detected.entities.serverRef;
      if (!toolName) return [];
      const { rows } = await repositories.registry.searchToolsAcrossServers(organizationId, {
        query: toolName.split('.').pop() ?? toolName,
        preferredVersionsOnly: true,
        limit: 3,
        offset: 0,
      });
      if (rows.length === 0) return [];
      return rows.flatMap((tool) => {
        const properties = Object.keys(
          (tool.inputSchema['properties'] as Record<string, unknown> | undefined) ?? {},
        );
        const required = Array.isArray(tool.inputSchema['required'])
          ? (tool.inputSchema['required'] as string[])
          : [];
        return [
          {
            label: `${tool.serverSlug}.${tool.name}`,
            value: truncate(tool.description ?? '(no description)', 200),
            source: 'server_tools',
            href: `/tools?q=${encodeURIComponent(tool.name)}`,
          },
          {
            label: 'Parameters',
            value: properties.length ? properties.join(', ') : '(none)',
            source: 'server_tools',
          },
          {
            label: 'Required',
            value: required.length ? required.join(', ') : '(none)',
            source: 'server_tools',
          },
          {
            label: 'Risk classification',
            value: tool.riskOverride ?? tool.riskClass,
            source: 'server_tools',
          },
        ];
      });
    }

    case 'compatibility_issues': {
      const server = await resolveServer(detected, options);
      if (!server) return [];
      const [validation, compatibility] = await Promise.all([
        repositories.governance.latestValidationRun(organizationId, server.id),
        repositories.governance.listCompatibilityRuns(organizationId, server.id, 1),
      ]);
      const items: EvidenceItem[] = [];
      if (validation) {
        items.push({
          label: 'Latest validation',
          value: `${validation.outcome} — ${validation.errorCount} error(s), ${validation.warningCount} warning(s)`,
          source: 'validation_runs',
          href: `/servers/${server.slug}?tab=validation`,
        });
        for (const finding of validation.findings.slice(0, 5)) {
          items.push({
            label: `${finding.severity}: ${finding.rule}`,
            value: `${finding.location} — ${finding.message}`,
            source: 'validation_findings',
          });
        }
      }
      const latest = compatibility[0];
      if (latest) {
        items.push({
          label: 'Latest compatibility run',
          value: `${latest.passed} passed, ${latest.warnings} warning(s), ${latest.failed} failed`,
          source: 'compatibility_runs',
          href: `/testing`,
        });
      }
      return items;
    }

    case 'usage_stats': {
      const window = {
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        to: new Date(),
        bucketSeconds: 3600,
      };
      const [totals, top] = await Promise.all([
        repositories.analytics.invocationTotals(organizationId, window),
        repositories.analytics.topTools(organizationId, window, 5),
      ]);
      if (totals.total === 0) return [];
      const items: EvidenceItem[] = [
        {
          label: 'Tool calls (7 days)',
          value: String(totals.total),
          source: 'tool_invocations',
          href: '/analytics',
        },
        { label: 'Succeeded', value: String(totals.succeeded), source: 'tool_invocations' },
        { label: 'Failed', value: String(totals.failed), source: 'tool_invocations' },
      ];
      if (totals.p95LatencyMs != null) {
        items.push({
          label: 'p95 latency',
          value: `${totals.p95LatencyMs}ms`,
          source: 'tool_invocations',
        });
      }
      for (const tool of top) {
        items.push({
          label: `${tool.serverSlug}.${tool.toolName}`,
          value: `${tool.calls} call(s), ${tool.errorRate}% errors`,
          source: 'tool_invocations',
        });
      }
      return items;
    }

    default:
      return [];
  }
}

async function resolveServer(
  detected: DetectedIntent,
  options: AskOptions,
): Promise<Awaited<ReturnType<RegistryRepository['findServerBySlug']>>> {
  const ref = detected.entities.serverRef;
  if (ref) {
    const bySlug = await options.repositories.registry.findServerBySlug(
      options.organizationId,
      ref.toLowerCase().replace(/\s+/g, '-'),
    );
    if (bySlug) return bySlug;
  }

  // Fall back to a search over indexed server documents.
  const text = ref ?? detected.entities.searchText ?? '';
  if (text.trim().length < 2) return null;
  const { hits } = await options.repositories.search.search({
    organizationId: options.organizationId,
    query: text,
    docTypes: ['server'],
    includePublic: false,
    limit: 1,
    offset: 0,
    trigram: options.trigram ?? false,
  });
  const hit = hits[0];
  if (!hit) return null;
  return options.repositories.registry.findServerById(options.organizationId, hit.serverId);
}

/** Deterministic prose assembled from evidence. Also the grounded fallback. */
export function renderEvidence(intent: AssistantIntent, evidence: readonly EvidenceItem[]): string {
  const lead: Record<AssistantIntent, string> = {
    server_health: 'Here is what the recorded health checks show.',
    version_changes: 'Here is what changed between those versions.',
    find_servers: 'These registry entries matched.',
    explain_tool: 'Here is the recorded definition of that tool.',
    compatibility_issues: 'Here are the most recent validation and compatibility results.',
    usage_stats: 'Here is the recorded usage.',
    unsupported: '',
  };
  return [lead[intent], ...evidence.map((item) => `• ${item.label}: ${item.value}`)]
    .filter(Boolean)
    .join('\n');
}
