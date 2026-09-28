import { type JsonSchema, type RiskClass, SENSITIVE_RISK_CLASSES } from '@mcp-hub/core';

export interface RiskAssessment {
  riskClass: RiskClass;
  /** Human-readable justification, stored next to the classification. */
  reason: string;
  /** Every signal that fired, for the UI's "why?" disclosure. */
  signals: string[];
  /** 0–1. Low confidence is surfaced rather than hidden. */
  confidence: number;
}

export interface ToolLike {
  name: string;
  description?: string | null;
  inputSchema?: JsonSchema | null;
  /** MCP tool annotations, if the server provided them. */
  annotations?: Record<string, unknown> | null;
}

interface Rule {
  riskClass: RiskClass;
  label: string;
  /** Matched against the tool name. */
  name?: RegExp;
  /** Matched against name + description + schema property names. */
  text?: RegExp;
  weight: number;
}

/**
 * Heuristic rules, ordered by the severity of what they detect.
 *
 * This is explicitly NOT a proof of what a tool does — a server can name a
 * tool `read_file` and delete the filesystem. It exists so that the permission
 * engine has a defensible default and so reviewers know what to look at first.
 * Administrators can override any classification; the override, its author and
 * its reason are all persisted.
 */
const RULES: Rule[] = [
  // ADMIN
  {
    riskClass: 'ADMIN',
    label: 'administrative verb',
    name: /^(admin|grant|revoke|impersonate|sudo|escalate)[_-]?/i,
    weight: 10,
  },
  {
    riskClass: 'ADMIN',
    label: 'permission management',
    text: /\b(iam|role[_ -]?binding|acl|permission|policy)\b.*\b(set|update|attach|grant)\b/i,
    weight: 8,
  },
  {
    riskClass: 'ADMIN',
    label: 'user or account management',
    name: /(create|delete|update)[_-](user|account|member|org|organisation|organization)s?$/i,
    weight: 8,
  },

  // DESTRUCTIVE
  {
    riskClass: 'DESTRUCTIVE',
    label: 'destructive verb in name',
    name: /^(delete|destroy|drop|remove|purge|truncate|wipe|erase|rm|unlink|terminate|kill|revert|reset|force[_-]push)[_-]?/i,
    weight: 10,
  },
  {
    riskClass: 'DESTRUCTIVE',
    label: 'destructive verb anywhere in name',
    name: /[_-](delete|destroy|drop|purge|truncate|wipe)([_-]|$)/i,
    weight: 9,
  },
  {
    riskClass: 'DESTRUCTIVE',
    label: 'irreversible language in description',
    text: /\b(permanently|irreversib\w+|cannot be undone|destructive|data loss)\b/i,
    weight: 7,
  },
  {
    riskClass: 'DESTRUCTIVE',
    label: 'shell or code execution',
    name: /(exec|execute|eval|run[_-]?(command|shell|script|code)|spawn|shell)/i,
    weight: 9,
  },

  // CREDENTIAL
  {
    riskClass: 'CREDENTIAL',
    label: 'credential in name',
    name: /(secret|credential|password|token|api[_-]?key|private[_-]?key|keychain|vault)/i,
    weight: 9,
  },
  {
    riskClass: 'CREDENTIAL',
    label: 'credential in schema',
    text: /"(password|secret|token|api_?key|access_?key|private_?key|client_?secret)"/i,
    weight: 7,
  },
  {
    riskClass: 'CREDENTIAL',
    label: 'authentication operation',
    text: /\b(authenticate|login|sign[_ -]?in|oauth|refresh token)\b/i,
    weight: 5,
  },

  // NETWORK
  {
    riskClass: 'NETWORK',
    label: 'outbound request verb',
    name: /^(fetch|http|request|curl|download|upload|post|webhook|browse|navigate|crawl|scrape)[_-]?/i,
    weight: 7,
  },
  {
    riskClass: 'NETWORK',
    label: 'accepts a URL',
    text: /"(url|uri|endpoint|host|address|webhook_url)"/i,
    weight: 5,
  },
  {
    riskClass: 'NETWORK',
    label: 'network language',
    text: /\b(http request|remote server|external api|send an? email|sms)\b/i,
    weight: 4,
  },

  // WRITE
  {
    riskClass: 'WRITE',
    label: 'write verb in name',
    name: /^(create|write|update|set|put|patch|insert|add|append|edit|modify|upsert|rename|move|copy|merge|publish|post|send|comment|assign|close|open|apply|commit|push|deploy|install|configure)[_-]?/i,
    weight: 6,
  },
  {
    riskClass: 'WRITE',
    label: 'mutation language',
    text: /\b(creates?|writes?|updates?|modif\w+|saves?|persists?)\b/i,
    weight: 3,
  },

  // READ
  {
    riskClass: 'READ',
    label: 'read verb in name',
    name: /^(get|list|read|search|find|query|fetch[_-]?(info|status)|describe|show|inspect|view|check|count|stat|summar\w+|resolve|lookup|diff|compare)[_-]?/i,
    weight: 5,
  },
  {
    riskClass: 'READ',
    label: 'read-only language',
    text: /\b(returns?|retrieves?|reads?|lists?|queries)\b/i,
    weight: 2,
  },
];

const SEVERITY_ORDER: RiskClass[] = [
  'ADMIN',
  'DESTRUCTIVE',
  'CREDENTIAL',
  'NETWORK',
  'WRITE',
  'READ',
  'UNKNOWN',
];

/**
 * Classifies a tool. Rules are additive per class and the most severe class
 * with a meaningful score wins, because under-classifying is the dangerous
 * failure mode.
 */
export function classifyTool(tool: ToolLike): RiskAssessment {
  const name = tool.name ?? '';
  const description = tool.description ?? '';
  const schemaText = tool.inputSchema ? JSON.stringify(tool.inputSchema) : '';
  const haystack = `${name} ${description} ${schemaText}`;

  const scores = new Map<RiskClass, number>();
  const signals: string[] = [];

  for (const rule of RULES) {
    const matched =
      (rule.name ? rule.name.test(name) : false) || (rule.text ? rule.text.test(haystack) : false);
    if (!matched) continue;
    scores.set(rule.riskClass, (scores.get(rule.riskClass) ?? 0) + rule.weight);
    signals.push(`${rule.riskClass}: ${rule.label}`);
  }

  // MCP tool annotations are hints from the server, so they adjust rather than
  // decide: a server claiming `readOnlyHint` cannot downgrade a DESTRUCTIVE match.
  const annotations = tool.annotations ?? {};
  if (annotations['destructiveHint'] === true) {
    scores.set('DESTRUCTIVE', (scores.get('DESTRUCTIVE') ?? 0) + 6);
    signals.push('DESTRUCTIVE: server-declared destructiveHint');
  }
  if (annotations['readOnlyHint'] === true) {
    scores.set('READ', (scores.get('READ') ?? 0) + 4);
    signals.push('READ: server-declared readOnlyHint');
  }

  if (scores.size === 0) {
    return {
      riskClass: 'UNKNOWN',
      reason:
        'No classification signal matched this tool. Unknown tools are treated as sensitive and require approval.',
      signals: [],
      confidence: 0,
    };
  }

  let winner: RiskClass = 'UNKNOWN';
  let winningScore = 0;
  for (const candidate of SEVERITY_ORDER) {
    const score = scores.get(candidate) ?? 0;
    if (score >= 5) {
      winner = candidate;
      winningScore = score;
      break;
    }
  }
  if (winner === 'UNKNOWN') {
    // Nothing scored strongly; take the highest-severity weak signal.
    for (const candidate of SEVERITY_ORDER) {
      const score = scores.get(candidate) ?? 0;
      if (score > 0) {
        winner = candidate;
        winningScore = score;
        break;
      }
    }
  }

  const total = [...scores.values()].reduce((a, b) => a + b, 0);
  const matchedLabels = signals
    .filter((s) => s.startsWith(`${winner}:`))
    .map((s) => s.slice(winner.length + 2));

  return {
    riskClass: winner,
    reason:
      matchedLabels.length > 0
        ? `Classified ${winner} from: ${matchedLabels.join('; ')}.`
        : `Classified ${winner}.`,
    signals,
    confidence: total === 0 ? 0 : Math.min(1, Math.round((winningScore / total) * 100) / 100),
  };
}

export function isSensitive(riskClass: RiskClass): boolean {
  return SENSITIVE_RISK_CLASSES.includes(riskClass);
}
