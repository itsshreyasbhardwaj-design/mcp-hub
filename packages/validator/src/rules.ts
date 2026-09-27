import { isSlug } from '@mcp-hub/core';
import { scanForInjection } from '@mcp-hub/security';
import { inspectSchema } from './jsonschema.js';
import type { ValidationRule } from './types.js';

/** MCP tool names are referenced by clients and models; keep them boring. */
const TOOL_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const URI_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The rule set.
 *
 * Every rule has a stable id that appears in the UI, the API and
 * `docs/validation-rules.md`, so a finding can be looked up, suppressed or
 * argued with. Severity follows one principle: ERROR means a client will
 * likely break, WARNING means a human or a model will likely be confused.
 */
export const RULES: ValidationRule[] = [
  // --- Server metadata ----------------------------------------------------
  {
    id: 'server.slug.invalid',
    title: 'Server slug is not URL-safe',
    severity: 'error',
    run: ({ target, report }) => {
      if (!isSlug(target.server.slug)) {
        report({
          severity: 'error',
          rule: 'server.slug.invalid',
          location: 'server.slug',
          message: `"${target.server.slug}" is not a valid slug.`,
          suggestion: 'Use 2–64 lowercase alphanumeric characters separated by single hyphens.',
        });
      }
    },
  },
  {
    id: 'server.description.missing',
    title: 'Server has no description',
    severity: 'warning',
    run: ({ target, report }) => {
      const description = target.server.description?.trim() ?? '';
      if (description.length === 0) {
        report({
          severity: 'warning',
          rule: 'server.description.missing',
          location: 'server.description',
          message: 'The server has no description.',
          suggestion: 'Describe what the server does; discovery search ranks on this text.',
        });
      } else if (description.length < 20) {
        report({
          severity: 'info',
          rule: 'server.description.missing',
          location: 'server.description',
          message: 'The description is very short.',
          suggestion: 'One or two sentences makes the server far easier to find.',
        });
      }
    },
  },
  {
    id: 'server.url.invalid',
    title: 'A published URL is not a valid http(s) URL',
    severity: 'error',
    run: ({ target, report }) => {
      const fields = [
        ['repositoryUrl', target.server.repositoryUrl],
        ['documentationUrl', target.server.documentationUrl],
        ['homepageUrl', target.server.homepageUrl],
      ] as const;
      for (const [field, value] of fields) {
        if (value && !isHttpUrl(value)) {
          report({
            severity: 'error',
            rule: 'server.url.invalid',
            location: `server.${field}`,
            message: `"${value}" is not a valid http(s) URL.`,
            suggestion: 'Use an absolute URL beginning with https://.',
          });
        }
      }
    },
  },
  {
    id: 'server.license.missing',
    title: 'Server declares no license',
    severity: 'info',
    run: ({ target, report }) => {
      if (!target.server.license?.trim()) {
        report({
          severity: 'info',
          rule: 'server.license.missing',
          location: 'server.license',
          message: 'No license is declared.',
          suggestion: 'Record the upstream license so consumers know the terms of use.',
        });
      }
    },
  },
  {
    id: 'server.tags.noisy',
    title: 'Tag list is unusable',
    severity: 'warning',
    run: ({ target, report }) => {
      const tags = target.server.tags;
      if (tags.length > 15) {
        report({
          severity: 'warning',
          rule: 'server.tags.noisy',
          location: 'server.tags',
          message: `${tags.length} tags are declared.`,
          suggestion: 'Keep to a handful of meaningful tags; long lists dilute search relevance.',
        });
      }
      const duplicates = tags.filter((tag, index) => tags.indexOf(tag) !== index);
      if (duplicates.length > 0) {
        report({
          severity: 'warning',
          rule: 'server.tags.noisy',
          location: 'server.tags',
          message: `Duplicate tags: ${[...new Set(duplicates)].join(', ')}.`,
          suggestion: 'Remove the duplicates.',
        });
      }
    },
  },

  // --- Version & transport ------------------------------------------------
  {
    id: 'version.semver.non-standard',
    title: 'Version string is not semver-like',
    severity: 'warning',
    run: ({ target, report }) => {
      if (!target.version) return;
      const version = target.version.version;
      if (!/^v?\d+\.\d+(\.\d+)?([-+].+)?$/.test(version)) {
        report({
          severity: 'warning',
          rule: 'version.semver.non-standard',
          location: 'version.version',
          message: `"${version}" does not look like a semantic version.`,
          suggestion: 'Use MAJOR.MINOR.PATCH so version comparison and diffing are meaningful.',
        });
      }
    },
  },
  {
    id: 'transport.config.invalid',
    title: 'Transport configuration is incomplete',
    severity: 'error',
    run: ({ target, report }) => {
      const transport = target.version?.transport;
      if (!transport) return;
      if (transport.kind === 'stdio') {
        if (!transport.command?.trim()) {
          report({
            severity: 'error',
            rule: 'transport.config.invalid',
            location: 'version.transport.command',
            message: 'A stdio transport needs a command.',
            suggestion: 'Set the executable, e.g. "npx".',
          });
        }
        if (!Array.isArray(transport.args)) {
          report({
            severity: 'error',
            rule: 'transport.config.invalid',
            location: 'version.transport.args',
            message: '"args" must be an array of strings.',
            suggestion: 'Split the command line into separate arguments.',
          });
        }
      } else {
        if (!isHttpUrl(transport.url ?? '')) {
          report({
            severity: 'error',
            rule: 'transport.config.invalid',
            location: 'version.transport.url',
            message: `"${transport.url}" is not a valid http(s) endpoint.`,
            suggestion: 'Use an absolute https:// URL.',
          });
        } else if (new URL(transport.url).protocol === 'http:') {
          report({
            severity: 'warning',
            rule: 'transport.config.invalid',
            location: 'version.transport.url',
            message: 'The endpoint uses plaintext HTTP.',
            suggestion: 'Use https:// so credentials and tool arguments are not sent in the clear.',
          });
        }
      }
    },
  },
  {
    id: 'environment.undeclared',
    title: 'Transport references credentials that are not declared',
    severity: 'warning',
    run: ({ target, report }) => {
      const version = target.version;
      if (!version) return;
      const declared = new Set(version.environment.map((e) => e.key));
      const referenced =
        version.transport.kind === 'stdio' ? version.transport.envKeys : version.transport.headerKeys;
      for (const key of referenced) {
        if (!declared.has(key)) {
          report({
            severity: 'warning',
            rule: 'environment.undeclared',
            location: 'version.environment',
            message: `The transport uses "${key}" but the version does not declare it.`,
            suggestion: `Add "${key}" to the environment requirements so operators know to supply it.`,
          });
        }
      }
      for (const requirement of version.environment) {
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(requirement.key)) {
          report({
            severity: 'error',
            rule: 'environment.undeclared',
            location: `version.environment.${requirement.key}`,
            message: `"${requirement.key}" is not a valid environment variable or header name.`,
            suggestion: 'Use letters, digits, underscores and hyphens only.',
          });
        }
      }
    },
  },
  {
    id: 'capabilities.inconsistent',
    title: 'Declared capabilities do not match what was discovered',
    severity: 'warning',
    run: ({ target, report }) => {
      const capabilities = target.version?.capabilities;
      if (!capabilities) return;
      const checks: Array<[string, number]> = [
        ['tools', target.tools.length],
        ['resources', target.resources.length],
        ['prompts', target.prompts.length],
      ];
      for (const [capability, count] of checks) {
        const declared = Boolean(capabilities[capability]);
        if (declared && count === 0) {
          report({
            severity: 'warning',
            rule: 'capabilities.inconsistent',
            location: `version.capabilities.${capability}`,
            message: `The server advertises the "${capability}" capability but exposes none.`,
            suggestion: `Remove the capability, or check why ${capability}/list returned nothing.`,
          });
        }
        if (!declared && count > 0) {
          report({
            severity: 'error',
            rule: 'capabilities.inconsistent',
            location: `version.capabilities.${capability}`,
            message: `${count} ${capability} were discovered but the capability is not advertised.`,
            suggestion: `Advertise "${capability}" during initialize; strict clients will not call it otherwise.`,
          });
        }
      }
    },
  },
  {
    id: 'protocol.version.unknown',
    title: 'Unrecognised protocol version',
    severity: 'warning',
    run: ({ target, report }) => {
      const protocolVersion = target.version?.protocolVersion;
      if (!protocolVersion) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(protocolVersion)) {
        report({
          severity: 'warning',
          rule: 'protocol.version.unknown',
          location: 'version.protocolVersion',
          message: `"${protocolVersion}" is not an MCP protocol revision date.`,
          suggestion: 'MCP revisions are dates, e.g. 2025-06-18.',
        });
      }
    },
  },

  // --- Tools --------------------------------------------------------------
  {
    id: 'tool.name.invalid',
    title: 'Tool name is not a valid identifier',
    severity: 'error',
    run: ({ target, report }) => {
      for (const tool of target.tools) {
        if (!TOOL_NAME_RE.test(tool.name)) {
          report({
            severity: 'error',
            rule: 'tool.name.invalid',
            location: `tools.${tool.name}`,
            message: `"${tool.name}" is not a valid tool name.`,
            suggestion:
              'Start with a letter and use only letters, digits, underscores and hyphens (max 64 characters).',
          });
        }
      }
    },
  },
  {
    id: 'tool.name.duplicate',
    title: 'Duplicate tool names',
    severity: 'error',
    run: ({ target, report }) => {
      const seen = new Map<string, number>();
      for (const tool of target.tools) {
        seen.set(tool.name, (seen.get(tool.name) ?? 0) + 1);
      }
      for (const [name, count] of seen) {
        if (count > 1) {
          report({
            severity: 'error',
            rule: 'tool.name.duplicate',
            location: `tools.${name}`,
            message: `"${name}" is defined ${count} times.`,
            suggestion: 'Tool names must be unique; a client cannot address the duplicates.',
          });
        }
      }
    },
  },
  {
    id: 'tool.name.collision-risk',
    title: 'Tool names differ only by case or separator',
    severity: 'warning',
    run: ({ target, report }) => {
      const normalized = new Map<string, string[]>();
      for (const tool of target.tools) {
        const key = tool.name.toLowerCase().replace(/[_-]/g, '');
        normalized.set(key, [...(normalized.get(key) ?? []), tool.name]);
      }
      for (const names of normalized.values()) {
        if (names.length > 1) {
          report({
            severity: 'warning',
            rule: 'tool.name.collision-risk',
            location: `tools.${names[0]}`,
            message: `Tools ${names.join(', ')} are easily confused with one another.`,
            suggestion: 'Rename so the names differ by more than case or punctuation.',
          });
        }
      }
    },
  },
  {
    id: 'tool.description.missing',
    title: 'Tool has no description',
    severity: 'warning',
    run: ({ target, report }) => {
      for (const tool of target.tools) {
        const description = tool.description?.trim() ?? '';
        if (description.length === 0) {
          report({
            severity: 'warning',
            rule: 'tool.description.missing',
            location: `tools.${tool.name}.description`,
            message: `Tool "${tool.name}" has no description.`,
            suggestion:
              'Describe what the tool does and when to use it. Models select tools almost entirely from this text.',
          });
        } else if (description.length < 15) {
          report({
            severity: 'info',
            rule: 'tool.description.missing',
            location: `tools.${tool.name}.description`,
            message: `The description of "${tool.name}" is very short.`,
            suggestion: 'Say what it does and what it returns.',
          });
        }
      }
    },
  },
  {
    id: 'tool.schema.invalid',
    title: 'Tool input schema is malformed',
    severity: 'error',
    run: ({ target, report }) => {
      for (const tool of target.tools) {
        const issues = inspectSchema(tool.inputSchema, `tools.${tool.name}.inputSchema`, {
          requireObjectRoot: true,
        });
        for (const issue of issues) {
          report({
            severity: issue.severity,
            rule:
              issue.severity === 'warning' && issue.message.includes('no description')
                ? 'tool.schema.undocumented-field'
                : 'tool.schema.invalid',
            location: issue.path,
            message: issue.message,
            suggestion: issue.suggestion,
          });
        }
      }
    },
  },
  {
    id: 'tool.output-schema.invalid',
    title: 'Tool output schema is malformed',
    severity: 'error',
    run: ({ target, report }) => {
      for (const tool of target.tools) {
        if (!tool.outputSchema) continue;
        for (const issue of inspectSchema(tool.outputSchema, `tools.${tool.name}.outputSchema`)) {
          report({
            severity: issue.severity === 'warning' ? 'info' : issue.severity,
            rule: 'tool.output-schema.invalid',
            location: issue.path,
            message: issue.message,
            suggestion: issue.suggestion,
          });
        }
      }
    },
  },
  {
    id: 'tool.annotations.unknown',
    title: 'Unrecognised tool annotation',
    severity: 'info',
    run: ({ target, report }) => {
      const known = new Set([
        'title',
        'readOnlyHint',
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
      ]);
      for (const tool of target.tools) {
        for (const key of Object.keys(tool.annotations ?? {})) {
          if (!known.has(key)) {
            report({
              severity: 'info',
              rule: 'tool.annotations.unknown',
              location: `tools.${tool.name}.annotations.${key}`,
              message: `Annotation "${key}" is not part of the MCP specification.`,
              suggestion: 'Clients will ignore it. Use the standard hints where they apply.',
            });
          }
        }
      }
    },
  },
  {
    id: 'tool.description.untrusted-content',
    title: 'Tool metadata contains content that targets a model',
    severity: 'error',
    run: ({ target, report }) => {
      for (const tool of target.tools) {
        for (const signal of scanForInjection(
          tool.description ?? '',
          `tools.${tool.name}.description`,
        )) {
          report({
            severity: signal.severity,
            rule: signal.rule,
            location: `tools.${tool.name}.description`,
            message: signal.title,
            suggestion:
              'Review this text before allowing the server. MCP Hub never executes instructions found in server metadata.',
          });
        }
      }
    },
  },

  // --- Resources & prompts ------------------------------------------------
  {
    id: 'resource.uri.invalid',
    title: 'Resource URI has no scheme',
    severity: 'error',
    run: ({ target, report }) => {
      for (const resource of target.resources) {
        if (!URI_SCHEME_RE.test(resource.uri)) {
          report({
            severity: 'error',
            rule: 'resource.uri.invalid',
            location: `resources.${resource.uri}`,
            message: `"${resource.uri}" is not an absolute URI.`,
            suggestion: 'Resource URIs need a scheme, e.g. file://, https:// or a custom one.',
          });
        }
      }
    },
  },
  {
    id: 'resource.mime.missing',
    title: 'Resource declares no MIME type',
    severity: 'info',
    run: ({ target, report }) => {
      for (const resource of target.resources) {
        if (!resource.mimeType) {
          report({
            severity: 'info',
            rule: 'resource.mime.missing',
            location: `resources.${resource.uri}`,
            message: `"${resource.uri}" declares no mimeType.`,
            suggestion: 'Declaring a MIME type lets clients render the resource correctly.',
          });
        }
      }
    },
  },
  {
    id: 'prompt.argument.invalid',
    title: 'Prompt argument is malformed',
    severity: 'error',
    run: ({ target, report }) => {
      for (const prompt of target.prompts) {
        const names = new Set<string>();
        for (const argument of prompt.arguments ?? []) {
          if (!argument.name || typeof argument.name !== 'string') {
            report({
              severity: 'error',
              rule: 'prompt.argument.invalid',
              location: `prompts.${prompt.name}.arguments`,
              message: 'A prompt argument has no name.',
              suggestion: 'Give every argument a name.',
            });
            continue;
          }
          if (names.has(argument.name)) {
            report({
              severity: 'error',
              rule: 'prompt.argument.invalid',
              location: `prompts.${prompt.name}.arguments.${argument.name}`,
              message: `Argument "${argument.name}" is declared more than once.`,
              suggestion: 'Remove the duplicate.',
            });
          }
          names.add(argument.name);
          if (!argument.description) {
            report({
              severity: 'info',
              rule: 'prompt.argument.invalid',
              location: `prompts.${prompt.name}.arguments.${argument.name}`,
              message: `Argument "${argument.name}" has no description.`,
              suggestion: 'Describe what the argument controls.',
            });
          }
        }
      }
    },
  },
  {
    id: 'surface.empty',
    title: 'Server exposes nothing',
    severity: 'warning',
    run: ({ target, report }) => {
      if (target.tools.length === 0 && target.resources.length === 0 && target.prompts.length === 0) {
        report({
          severity: 'warning',
          rule: 'surface.empty',
          location: 'version',
          message: 'No tools, resources or prompts were discovered for this version.',
          suggestion:
            'Run capability discovery against the server, or check that the transport configuration is correct.',
        });
      }
    },
  },
];
