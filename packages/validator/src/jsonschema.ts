import type { JsonSchema } from '@mcp-hub/core';

/**
 * A focused JSON Schema inspector.
 *
 * MCP Hub does not need a full validator here — it needs to tell an operator
 * which parts of a tool's schema will confuse a client. So this walks the
 * document and reports structural problems, rather than validating instances.
 */

export interface SchemaIssue {
  path: string;
  message: string;
  suggestion: string | null;
  severity: 'error' | 'warning' | 'info';
}

const KNOWN_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

export interface SchemaWalkOptions {
  maxDepth?: number;
  /** Root schemas for tool inputs must be objects, per the MCP specification. */
  requireObjectRoot?: boolean;
}

export function inspectSchema(
  schema: unknown,
  rootPath: string,
  options: SchemaWalkOptions = {},
): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const maxDepth = options.maxDepth ?? 12;

  if (schema == null || typeof schema !== 'object' || Array.isArray(schema)) {
    issues.push({
      path: rootPath,
      message: 'The schema is not a JSON object.',
      suggestion: 'Publish an object schema, e.g. {"type":"object","properties":{}}.',
      severity: 'error',
    });
    return issues;
  }

  const root = schema as JsonSchema;
  if (options.requireObjectRoot && root['type'] !== 'object') {
    issues.push({
      path: `${rootPath}.type`,
      message: `A tool input schema must have "type": "object"; found ${JSON.stringify(root['type'] ?? null)}.`,
      suggestion: 'Wrap the parameters in an object schema so clients can build a form for them.',
      severity: 'error',
    });
  }

  walk(root, rootPath, 0);
  return issues;

  function walk(node: JsonSchema, path: string, depth: number): void {
    if (depth > maxDepth) {
      issues.push({
        path,
        message: `Schema nests deeper than ${maxDepth} levels.`,
        suggestion: 'Flatten the schema; most MCP clients will not render this depth.',
        severity: 'warning',
      });
      return;
    }

    const type = node['type'];
    if (type !== undefined) {
      const types = Array.isArray(type) ? type : [type];
      for (const t of types) {
        if (typeof t !== 'string' || !KNOWN_TYPES.has(t)) {
          issues.push({
            path: `${path}.type`,
            message: `Unknown JSON Schema type ${JSON.stringify(t)}.`,
            suggestion: `Use one of: ${[...KNOWN_TYPES].join(', ')}.`,
            severity: 'error',
          });
        }
      }
    } else if (!node['$ref'] && !node['anyOf'] && !node['oneOf'] && !node['allOf'] && !node['enum'] && !node['const']) {
      issues.push({
        path,
        message: 'No "type", "enum", "const" or composition keyword is declared.',
        suggestion: 'Declare a type so clients know how to render and validate this value.',
        severity: 'warning',
      });
    }

    if (node['$ref'] !== undefined) {
      const ref = node['$ref'];
      if (typeof ref !== 'string' || (!ref.startsWith('#/') && ref !== '#')) {
        issues.push({
          path: `${path}.$ref`,
          message: `Reference ${JSON.stringify(ref)} is not a local JSON pointer.`,
          suggestion: 'Inline the definition or use a local #/$defs/... reference.',
          severity: 'error',
        });
      }
    }

    const properties = node['properties'];
    const required = node['required'];

    if (required !== undefined) {
      if (!Array.isArray(required) || required.some((r) => typeof r !== 'string')) {
        issues.push({
          path: `${path}.required`,
          message: '"required" must be an array of property names.',
          suggestion: 'Replace it with an array of strings.',
          severity: 'error',
        });
      } else if (properties && typeof properties === 'object') {
        const declared = new Set(Object.keys(properties as Record<string, unknown>));
        for (const name of required as string[]) {
          if (!declared.has(name)) {
            issues.push({
              path: `${path}.required`,
              message: `Required property "${name}" is not declared in "properties".`,
              suggestion: `Add "${name}" to properties, or remove it from required.`,
              severity: 'error',
            });
          }
        }
      } else if (Array.isArray(required) && required.length > 0) {
        issues.push({
          path: `${path}.required`,
          message: 'Properties are required but none are declared.',
          suggestion: 'Declare the properties this schema requires.',
          severity: 'error',
        });
      }
    }

    if (properties !== undefined) {
      if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
        issues.push({
          path: `${path}.properties`,
          message: '"properties" must be an object.',
          suggestion: null,
          severity: 'error',
        });
      } else {
        for (const [name, child] of Object.entries(properties as Record<string, unknown>)) {
          const childPath = `${path}.properties.${name}`;
          if (child == null || typeof child !== 'object' || Array.isArray(child)) {
            issues.push({
              path: childPath,
              message: 'Property schema is not an object.',
              suggestion: null,
              severity: 'error',
            });
            continue;
          }
          const childSchema = child as JsonSchema;
          if (typeof childSchema['description'] !== 'string' || !childSchema['description'].trim()) {
            issues.push({
              path: childPath,
              message: `Property "${name}" has no description.`,
              suggestion:
                'Add a description. Clients and models use it to decide what to put in the field.',
              severity: 'warning',
            });
          }
          walk(childSchema, childPath, depth + 1);
        }
      }
    }

    const enumValues = node['enum'];
    if (enumValues !== undefined) {
      if (!Array.isArray(enumValues)) {
        issues.push({
          path: `${path}.enum`,
          message: '"enum" must be an array.',
          suggestion: null,
          severity: 'error',
        });
      } else if (enumValues.length === 0) {
        issues.push({
          path: `${path}.enum`,
          message: 'An empty "enum" makes the field impossible to satisfy.',
          suggestion: 'Provide at least one permitted value, or remove the enum.',
          severity: 'error',
        });
      }
    }

    const items = node['items'];
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      walk(items as JsonSchema, `${path}.items`, depth + 1);
    }

    for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
      const branch = node[keyword];
      if (Array.isArray(branch)) {
        branch.forEach((sub, index) => {
          if (sub && typeof sub === 'object') walk(sub as JsonSchema, `${path}.${keyword}[${index}]`, depth + 1);
        });
      }
    }

    const defs = node['$defs'] ?? node['definitions'];
    if (defs && typeof defs === 'object') {
      for (const [name, sub] of Object.entries(defs as Record<string, unknown>)) {
        if (sub && typeof sub === 'object') walk(sub as JsonSchema, `${path}.$defs.${name}`, depth + 1);
      }
    }
  }
}

/** Lists the top-level parameters of a tool schema, for the schema inspector UI. */
export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
  enumValues: unknown[] | null;
  default: unknown;
  format: string | null;
  /** Nested object/array fields, one level at a time. */
  children: SchemaField[];
}

export function describeSchema(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== 'object') return [];
  const root = schema as JsonSchema;
  const properties = root['properties'];
  if (!properties || typeof properties !== 'object') return [];
  const required = new Set(Array.isArray(root['required']) ? (root['required'] as string[]) : []);

  return Object.entries(properties as Record<string, unknown>).map(([name, raw]) =>
    describeField(name, raw, required.has(name), 0),
  );
}

function describeField(name: string, raw: unknown, required: boolean, depth: number): SchemaField {
  const node = (raw && typeof raw === 'object' ? raw : {}) as JsonSchema;
  const type = Array.isArray(node['type'])
    ? (node['type'] as string[]).join(' | ')
    : typeof node['type'] === 'string'
      ? (node['type'] as string)
      : node['enum']
        ? 'enum'
        : node['anyOf'] || node['oneOf']
          ? 'union'
          : 'unknown';

  let children: SchemaField[] = [];
  if (depth < 4) {
    if (type === 'object' && node['properties'] && typeof node['properties'] === 'object') {
      const req = new Set(Array.isArray(node['required']) ? (node['required'] as string[]) : []);
      children = Object.entries(node['properties'] as Record<string, unknown>).map(([child, value]) =>
        describeField(child, value, req.has(child), depth + 1),
      );
    } else if (type === 'array' && node['items'] && typeof node['items'] === 'object') {
      children = [describeField('[item]', node['items'], false, depth + 1)];
    }
  }

  return {
    name,
    type,
    required,
    description: typeof node['description'] === 'string' ? node['description'] : null,
    enumValues: Array.isArray(node['enum']) ? (node['enum'] as unknown[]) : null,
    default: node['default'],
    format: typeof node['format'] === 'string' ? node['format'] : null,
    children,
  };
}

/** Builds a plausible example payload from a schema, for the playground. */
export function exampleForSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 5) return null;
  const node = schema as JsonSchema;
  if (node['default'] !== undefined) return node['default'];
  if (Array.isArray(node['enum']) && node['enum'].length > 0) return node['enum'][0];
  if (Array.isArray(node['examples']) && node['examples'].length > 0) return node['examples'][0];

  const type = Array.isArray(node['type']) ? node['type'][0] : node['type'];
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      const properties = (node['properties'] ?? {}) as Record<string, unknown>;
      const required = new Set(Array.isArray(node['required']) ? (node['required'] as string[]) : []);
      for (const [name, child] of Object.entries(properties)) {
        if (required.size > 0 && !required.has(name)) continue;
        out[name] = exampleForSchema(child, depth + 1);
      }
      return out;
    }
    case 'array':
      return node['items'] ? [exampleForSchema(node['items'], depth + 1)] : [];
    case 'string':
      return node['format'] === 'uri' ? 'https://example.com' : '';
    case 'number':
    case 'integer':
      return typeof node['minimum'] === 'number' ? node['minimum'] : 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return null;
  }
}
