export type AssistantIntent =
  | 'server_health'
  | 'version_changes'
  | 'find_servers'
  | 'explain_tool'
  | 'compatibility_issues'
  | 'usage_stats'
  | 'unsupported';

export interface DetectedIntent {
  intent: AssistantIntent;
  /** Entities lifted out of the question and used to build the query. */
  entities: {
    serverRef?: string;
    toolName?: string;
    fromVersion?: string;
    toVersion?: string;
    searchText?: string;
  };
  confidence: number;
}

const VERSION_RE = /\bv?(\d+\.\d+(?:\.\d+)?)\b/g;

/**
 * Rule-based intent detection.
 *
 * Deliberately not a model call: intent decides which *authorised database
 * query* runs, so it must be inspectable and must never be steerable by text
 * that reached the question from an untrusted source.
 */
export function detectIntent(question: string): DetectedIntent {
  const text = question.toLowerCase().trim();
  const entities: DetectedIntent['entities'] = {};

  const quoted = /["'`]([^"'`]{2,64})["'`]/.exec(question);
  if (quoted?.[1]) entities.serverRef = quoted[1];

  const versions = [...text.matchAll(VERSION_RE)].map((m) => m[1]).filter(Boolean) as string[];
  if (versions.length >= 2) {
    entities.fromVersion = versions[0];
    entities.toVersion = versions[1];
  }

  const toolMatch = /\b([a-z][a-z0-9]*(?:[_.][a-z0-9]+)+)\b/.exec(question);
  if (toolMatch?.[1]) entities.toolName = toolMatch[1];

  const score = (patterns: RegExp[]): number =>
    patterns.reduce((acc, pattern) => acc + (pattern.test(text) ? 1 : 0), 0);

  const candidates: Array<[AssistantIntent, number]> = [
    [
      'server_health',
      score([
        /\bwhy\b.*\b(fail|failing|down|broken|unhealthy|degraded)\b/,
        /\bhealth\b/,
        /\buptime\b/,
        /\bincident\b/,
        /\btimeout/,
      ]),
    ],
    [
      'version_changes',
      score([
        /\bchang(e|ed|es)\b/,
        /\bbetween\b.*\bv?\d/,
        /\bdiff\b/,
        /\bbreaking\b/,
        /\bupgrade\b/,
      ]),
    ],
    [
      'find_servers',
      score([
        /\bfind\b/,
        /\bwhich (servers?|tools?)\b/,
        /\bsearch\b/,
        /\blooking for\b/,
        /\bprovide\b/,
        /\bany servers?\b/,
      ]),
    ],
    [
      'explain_tool',
      score([/\bexplain\b/, /\bwhat does\b/, /\bschema\b/, /\bhow do i (call|use)\b/]),
    ],
    [
      'compatibility_issues',
      score([/\bcompatib/, /\bconform/, /\bspec\b/, /\bvalidation\b/, /\bwarnings?\b/]),
    ],
    [
      'usage_stats',
      score([
        /\bhow many\b/,
        /\bmost used\b/,
        /\busage\b/,
        /\bcalls?\b.*\b(last|past)\b/,
        /\berror rate\b/,
      ]),
    ],
  ];

  candidates.sort((a, b) => b[1] - a[1]);
  const best = candidates[0];
  if (!best || best[1] === 0) {
    return { intent: 'unsupported', entities, confidence: 0 };
  }

  if (best[0] === 'find_servers' && !entities.searchText) {
    entities.searchText = question
      .replace(/\b(find|search|which|any|servers?|tools?|that|provide|for|me|show|list)\b/gi, ' ')
      .replace(/[?.!]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const total = candidates.reduce((acc, [, value]) => acc + value, 0);
  return {
    intent: best[0],
    entities,
    confidence: total === 0 ? 0 : Math.round((best[1] / total) * 100) / 100,
  };
}
