import { type Severity, type ValidationFinding, newId } from '@mcp-hub/core';
import { RULES } from './rules.js';
import type { ValidationReport, ValidationTarget } from './types.js';

export interface ValidateOptions {
  /** Rule ids to skip, e.g. rules an organization has decided not to enforce. */
  disabledRules?: readonly string[];
}

/**
 * Runs every rule against the target and folds the findings into a report.
 * Rules are pure and independent, so a rule that throws is reported as its own
 * finding rather than failing the whole run.
 */
export function validate(
  target: ValidationTarget,
  options: ValidateOptions = {},
): ValidationReport {
  const started = performance.now();
  const disabled = new Set(options.disabledRules ?? []);
  const findings: ValidationFinding[] = [];
  const rulesRun: string[] = [];

  for (const rule of RULES) {
    if (disabled.has(rule.id)) continue;
    rulesRun.push(rule.id);
    try {
      rule.run({
        target,
        report: (finding) => {
          findings.push({ ...finding, id: newId('validationFinding') });
        },
      });
    } catch (err) {
      findings.push({
        id: newId('validationFinding'),
        severity: 'warning',
        rule: 'validator.rule-failed',
        location: rule.id,
        message: `Rule "${rule.id}" could not be evaluated.`,
        suggestion: err instanceof Error ? err.message : 'Unknown error.',
      });
    }
  }

  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.location.localeCompare(b.location),
  );

  return {
    outcome: counts.error > 0 ? 'error' : counts.warning > 0 ? 'warning' : 'pass',
    findings,
    counts,
    durationMs: Math.round(performance.now() - started),
    rulesRun,
  };
}

/** Machine-readable rule catalogue, published by the API and the docs. */
export function ruleCatalogue(): Array<{ id: string; title: string; severity: Severity }> {
  return RULES.map((rule) => ({ id: rule.id, title: rule.title, severity: rule.severity }));
}
