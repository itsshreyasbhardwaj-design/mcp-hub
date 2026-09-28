import type {
  EnvironmentRequirement,
  JsonSchema,
  Severity,
  TransportConfig,
  ValidationFinding,
  ValidationOutcome,
} from '@mcp-hub/core';

/** The document a validation rule sees. Deliberately plain data. */
export interface ValidationTarget {
  server: {
    slug: string;
    name: string;
    description: string | null;
    category: string | null;
    tags: string[];
    repositoryUrl: string | null;
    documentationUrl: string | null;
    homepageUrl: string | null;
    license: string | null;
    maintainer: string | null;
  };
  version: {
    version: string;
    transport: TransportConfig;
    environment: EnvironmentRequirement[];
    supportedPlatforms: string[];
    protocolVersion: string | null;
    capabilities: Record<string, unknown> | null;
  } | null;
  tools: Array<{
    name: string;
    title?: string | null;
    description?: string | null;
    inputSchema: JsonSchema;
    outputSchema?: JsonSchema | null;
    annotations?: Record<string, unknown> | null;
  }>;
  resources: Array<{
    uri: string;
    name?: string | null;
    description?: string | null;
    mimeType?: string | null;
  }>;
  prompts: Array<{
    name: string;
    description?: string | null;
    arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  }>;
}

export interface RuleContext {
  target: ValidationTarget;
  report: (finding: Omit<ValidationFinding, 'id'>) => void;
}

export interface ValidationRule {
  /** Stable identifier, e.g. `tool.name.invalid`. Referenced in docs. */
  id: string;
  title: string;
  severity: Severity;
  run: (context: RuleContext) => void;
}

export interface ValidationReport {
  outcome: ValidationOutcome;
  findings: ValidationFinding[];
  counts: Record<Severity, number>;
  durationMs: number;
  /** Rule ids that executed, so coverage is visible in the UI. */
  rulesRun: string[];
}
