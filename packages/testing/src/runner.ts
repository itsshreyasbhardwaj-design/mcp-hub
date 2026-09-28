import {
  type CompatibilityCaseResult,
  type CompatibilitySuite,
  type TransportConfig,
  withTimeout,
} from '@mcp-hub/core';
import { contextLogger, redact } from '@mcp-hub/observability';
import { withMcpSession } from '@mcp-hub/mcp-client';
import { TEST_CASES, newCaseResult, errorMessage, type TestCaseDefinition } from './suites.js';

export interface RunCompatibilityOptions {
  transport: TransportConfig;
  secrets?: Record<string, string>;
  suites?: CompatibilitySuite[];
  caseTimeoutMs?: number;
  connectTimeoutMs?: number;
  allowStdio?: boolean;
}

export interface CompatibilityRunSummary {
  suites: CompatibilitySuite[];
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
  durationMs: number;
  cases: CompatibilityCaseResult[];
}

/**
 * Executes the selected suites against a live server.
 *
 * A connection failure is not an exception here: it is a failed
 * `connection.initialize` case plus a skip for everything downstream, because
 * "the server would not start" is exactly the result an operator needs to see.
 */
export async function runCompatibility(
  options: RunCompatibilityOptions,
): Promise<CompatibilityRunSummary> {
  const suites = options.suites ?? ['connection', 'capabilities', 'schemas', 'behaviour'];
  const caseTimeoutMs = options.caseTimeoutMs ?? 15_000;
  const selected = TEST_CASES.filter((testCase) => suites.includes(testCase.suite));
  const startedAt = performance.now();

  let cases: CompatibilityCaseResult[];
  try {
    cases = await withMcpSession(
      {
        transport: options.transport,
        ...(options.secrets ? { secrets: options.secrets } : {}),
        requestTimeoutMs: options.connectTimeoutMs ?? caseTimeoutMs,
        ...(options.allowStdio !== undefined ? { allowStdio: options.allowStdio } : {}),
        clientInfo: { name: 'mcp-hub-compatibility', version: '0.1.0' },
      },
      async (client) => {
        const results: CompatibilityCaseResult[] = [];
        for (const definition of selected) {
          results.push(await runCase(definition, { client, caseTimeoutMs }));
        }
        return results;
      },
    );
  } catch (err) {
    cases = connectionFailureCases(selected, err);
  }

  return summarize(suites, cases, Math.round(performance.now() - startedAt));
}

async function runCase(
  definition: TestCaseDefinition,
  context: { client: Parameters<TestCaseDefinition['run']>[0]['client']; caseTimeoutMs: number },
): Promise<CompatibilityCaseResult> {
  const started = performance.now();
  try {
    const result = await withTimeout(
      definition.run({ client: context.client, caseTimeoutMs: context.caseTimeoutMs }),
      context.caseTimeoutMs,
      definition.key,
    );
    // Evidence comes from an untrusted server, so it is redacted before storage.
    const redacted = result.evidence
      ? (redact(result.evidence) as Record<string, unknown>)
      : undefined;
    return newCaseResult(
      definition,
      { ...result, ...(redacted ? { evidence: redacted } : {}) },
      Math.round(performance.now() - started),
    );
  } catch (err) {
    contextLogger().debug('Compatibility case threw', {
      key: definition.key,
      error: errorMessage(err),
    });
    return newCaseResult(
      definition,
      {
        outcome: 'failed',
        message: errorMessage(err),
        evidence: { rationale: definition.rationale },
      },
      Math.round(performance.now() - started),
    );
  }
}

function connectionFailureCases(
  selected: TestCaseDefinition[],
  err: unknown,
): CompatibilityCaseResult[] {
  const reason = errorMessage(err);
  return selected.map((definition) =>
    definition.key === 'connection.initialize'
      ? newCaseResult(definition, { outcome: 'failed', message: reason }, 0)
      : newCaseResult(
          definition,
          { outcome: 'skipped', message: 'Skipped: the connection could not be established.' },
          0,
        ),
  );
}

function summarize(
  suites: CompatibilitySuite[],
  cases: CompatibilityCaseResult[],
  durationMs: number,
): CompatibilityRunSummary {
  return {
    suites,
    total: cases.length,
    passed: cases.filter((c) => c.outcome === 'passed').length,
    warnings: cases.filter((c) => c.outcome === 'warning').length,
    failed: cases.filter((c) => c.outcome === 'failed').length,
    skipped: cases.filter((c) => c.outcome === 'skipped').length,
    durationMs,
    cases,
  };
}

/** The catalogue, published by the API so clients can show what will run. */
export function suiteCatalogue(): Array<{
  suite: CompatibilitySuite;
  key: string;
  title: string;
  rationale: string;
}> {
  return TEST_CASES.map(({ suite, key, title, rationale }) => ({ suite, key, title, rationale }));
}
