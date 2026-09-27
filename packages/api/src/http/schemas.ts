import { z } from 'zod';
import { HubError, RISK_CLASSES, SERVER_STATUS, VISIBILITY, PERMISSION_EFFECTS, ORG_ROLES, API_SCOPES, COMPATIBILITY_SUITES } from '@mcp-hub/core';

/**
 * Request validation.
 *
 * Every mutating endpoint parses its body through one of these. Validation is
 * a security control, not a convenience: it is what stops an unexpected field
 * reaching a repository or a transport config.
 */
export function parse<T>(schema: z.ZodType<T>, value: unknown, what = 'request body'): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.slice(0, 10).map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  throw new HubError('VALIDATION_FAILED', `The ${what} is invalid.`, { details: { issues } });
}

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be lowercase alphanumeric segments separated by hyphens');

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), 'Must be an http(s) URL');

export const environmentRequirementSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, 'Must be a valid variable or header name'),
  description: z.string().max(500).nullable().default(null),
  required: z.boolean().default(true),
  secret: z.boolean().default(false),
});

export const transportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('stdio'),
    command: z.string().min(1).max(500),
    args: z.array(z.string().max(1000)).max(50).default([]),
    envKeys: z.array(z.string().max(128)).max(50).default([]),
    cwd: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    kind: z.literal('streamable-http'),
    url: httpUrl,
    headerKeys: z.array(z.string().max(128)).max(50).default([]),
  }),
]);

export const registerServerSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slug.optional(),
  description: z.string().max(4000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
  repositoryUrl: httpUrl.nullable().optional(),
  documentationUrl: httpUrl.nullable().optional(),
  homepageUrl: httpUrl.nullable().optional(),
  license: z.string().max(100).nullable().optional(),
  maintainer: z.string().max(200).nullable().optional(),
  visibility: z.enum(VISIBILITY).optional(),
  status: z.enum(SERVER_STATUS).optional(),
  healthIntervalSeconds: z.number().int().min(60).max(86_400).nullable().optional(),
  version: z
    .object({
      version: z.string().min(1).max(64),
      transport: transportSchema,
      environment: z.array(environmentRequirementSchema).max(50).optional(),
      supportedPlatforms: z.array(z.string().max(32)).max(10).optional(),
      releaseNotes: z.string().max(10_000).nullable().optional(),
    })
    .optional(),
});

export const updateServerSchema = registerServerSchema
  .omit({ slug: true, version: true })
  .partial();

export const createVersionSchema = z.object({
  version: z.string().min(1).max(64),
  transport: transportSchema,
  environment: z.array(environmentRequirementSchema).max(50).optional(),
  supportedPlatforms: z.array(z.string().max(32)).max(10).optional(),
  releaseNotes: z.string().max(10_000).nullable().optional(),
});

export const publishVersionSchema = z.object({
  markRecommended: z.boolean().optional(),
});

export const versionFlagsSchema = z
  .object({
    deprecated: z.boolean().optional(),
    recommended: z.boolean().optional(),
  })
  .refine((value) => value.deprecated !== undefined || value.recommended !== undefined, {
    message: 'Set at least one of "deprecated" or "recommended".',
  });

export const discoverSchema = z.object({
  environmentId: z.string().max(64).nullable().optional(),
});

export const compatibilitySchema = z.object({
  versionId: z.string().min(1).max(64),
  environmentId: z.string().max(64).nullable().optional(),
  suites: z.array(z.enum(COMPATIBILITY_SUITES)).min(1).optional(),
});

export const executeToolSchema = z.object({
  versionId: z.string().min(1).max(64),
  toolName: z.string().min(1).max(128),
  arguments: z.unknown().optional(),
  environmentId: z.string().max(64).nullable().optional(),
  acknowledgeRisk: z.boolean().optional(),
  approvalId: z.string().max(64).nullable().optional(),
});

export const requestApprovalSchema = z.object({
  versionId: z.string().min(1).max(64),
  toolName: z.string().min(1).max(128),
  arguments: z.unknown().optional(),
  reason: z.string().max(1000).nullable().optional(),
});

export const decideApprovalSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  reason: z.string().max(1000).nullable().optional(),
});

export const permissionRuleSchema = z.object({
  effect: z.enum(PERMISSION_EFFECTS),
  subjectUserId: z.string().max(64).nullable().optional(),
  subjectRole: z.enum(ORG_ROLES).nullable().optional(),
  serverId: z.string().max(64).nullable().optional(),
  versionId: z.string().max(64).nullable().optional(),
  toolName: z.string().max(128).nullable().optional(),
  riskClass: z.enum(RISK_CLASSES).nullable().optional(),
  environmentId: z.string().max(64).nullable().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  description: z.string().max(500).nullable().optional(),
});

export const riskOverrideSchema = z.object({
  riskClass: z.enum(RISK_CLASSES).nullable(),
  reason: z.string().min(5).max(500),
});

export const apiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export const memberSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(ORG_ROLES),
});

export const roleChangeSchema = z.object({ role: z.enum(ORG_ROLES) });

export const teamSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
});

export const configSchema = z.object({
  versionId: z.string().min(1).max(64),
  format: z.enum(['claude-desktop', 'mcp-json', 'env', 'vscode', 'raw']),
  environmentId: z.string().max(64).nullable().optional(),
  serverKey: z.string().max(100).optional(),
});

export const importPreviewSchema = z.object({
  content: z.string().min(2).max(512_000),
});

export const importConfirmSchema = z.object({
  candidates: z
    .array(
      z.object({
        slug,
        name: z.string().min(1).max(200),
        transport: transportSchema,
        environment: z.array(environmentRequirementSchema).max(50).default([]),
        version: z.string().max(64).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export const environmentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  transportOverride: transportSchema.nullable().optional(),
});

export const secretSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/),
  value: z.string().min(1).max(8192),
  environmentId: z.string().max(64).nullable().optional(),
});

export const assistantSchema = z.object({
  question: z.string().min(3).max(500),
});

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slug.optional(),
});

export const devSignInSchema = z.object({
  email: z.string().email().max(320),
});
