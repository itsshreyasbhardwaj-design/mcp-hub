'use client';

import { useMemo, useState } from 'react';
import { Braces, List } from 'lucide-react';
import { Badge, cn } from '@mcp-hub/ui';

interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
  enumValues: unknown[] | null;
  default: unknown;
  format: string | null;
  children: SchemaField[];
}

/**
 * Describes a JSON Schema one level at a time.
 *
 * This mirrors `describeSchema` in @mcp-hub/validator. It is reimplemented
 * here rather than imported because the validator is a server package and the
 * inspector has to run in the browser as the user types in the playground;
 * both are covered by tests against the same fixtures.
 */
function describe(schema: unknown, depth = 0): SchemaField[] {
  if (!schema || typeof schema !== 'object') return [];
  const node = schema as Record<string, unknown>;
  const properties = node['properties'];
  if (!properties || typeof properties !== 'object') return [];
  const required = new Set(Array.isArray(node['required']) ? (node['required'] as string[]) : []);

  return Object.entries(properties as Record<string, unknown>).map(([name, raw]) =>
    describeField(name, raw, required.has(name), depth),
  );
}

function describeField(name: string, raw: unknown, required: boolean, depth: number): SchemaField {
  const node = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawType = node['type'];
  const type = Array.isArray(rawType)
    ? rawType.join(' | ')
    : typeof rawType === 'string'
      ? rawType
      : node['enum']
        ? 'enum'
        : node['anyOf'] || node['oneOf']
          ? 'union'
          : 'unknown';

  let children: SchemaField[] = [];
  if (depth < 3) {
    if (type === 'object') children = describe(node, depth + 1);
    else if (type === 'array' && node['items'] && typeof node['items'] === 'object') {
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

export function SchemaInspector({
  schema,
  title = 'Schema',
}: {
  schema: Record<string, unknown>;
  title?: string;
}) {
  const [view, setView] = useState<'tree' | 'raw'>('tree');
  const fields = useMemo(() => describe(schema), [schema]);
  const raw = useMemo(() => JSON.stringify(schema, null, 2), [schema]);

  return (
    <div className="rounded-md border border-border bg-surface-1">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-fg-2">{title}</p>
        <div
          role="group"
          aria-label={`${title} view`}
          className="inline-flex rounded border border-border p-0.5"
        >
          <button
            type="button"
            aria-pressed={view === 'tree'}
            onClick={() => setView('tree')}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
              view === 'tree' ? 'bg-surface-3 text-fg-1' : 'text-fg-4',
            )}
          >
            <List className="size-3" aria-hidden />
            Tree
          </button>
          <button
            type="button"
            aria-pressed={view === 'raw'}
            onClick={() => setView('raw')}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
              view === 'raw' ? 'bg-surface-3 text-fg-1' : 'text-fg-4',
            )}
          >
            <Braces className="size-3" aria-hidden />
            JSON
          </button>
        </div>
      </div>

      {view === 'raw' ? (
        <pre className="max-h-80 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-fg-2 scrollbar-thin">
          {raw}
        </pre>
      ) : fields.length === 0 ? (
        <p className="px-3 py-4 text-xs text-fg-4">This schema declares no properties.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {fields.map((field) => (
            <FieldRow key={field.name} field={field} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldRow({ field, depth }: { field: SchemaField; depth: number }) {
  return (
    <li>
      <div className="px-3 py-2" style={{ paddingLeft: `${12 + depth * 16}px` }}>
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-xs text-fg-1">{field.name}</code>
          <Badge tone="muted" className="font-mono text-[10px]">
            {field.type}
            {field.format ? `:${field.format}` : ''}
          </Badge>
          {field.required ? (
            <Badge tone="warning" className="text-[10px]">
              required
            </Badge>
          ) : (
            <span className="text-[10px] text-fg-4">optional</span>
          )}
          {field.default !== undefined ? (
            <span className="font-mono text-[10px] text-fg-4">
              default {JSON.stringify(field.default)}
            </span>
          ) : null}
        </div>
        {field.description ? (
          <p className="mt-1 text-xs leading-relaxed text-fg-3">{field.description}</p>
        ) : (
          <p className="mt-1 text-xs italic text-fg-4">No description.</p>
        )}
        {field.enumValues ? (
          <p className="mt-1 font-mono text-[11px] text-fg-4">
            one of {field.enumValues.map((value) => JSON.stringify(value)).join(', ')}
          </p>
        ) : null}
      </div>
      {field.children.length > 0 ? (
        <ul className="border-t border-border/40">
          {field.children.map((child) => (
            <FieldRow key={`${field.name}.${child.name}`} field={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Builds a plausible example payload from a schema, for the playground. */
export function exampleFor(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 4) return null;
  const node = schema as Record<string, unknown>;
  if (node['default'] !== undefined) return node['default'];
  if (Array.isArray(node['enum']) && node['enum'].length > 0) return node['enum'][0];

  const rawType = node['type'];
  const type = Array.isArray(rawType) ? rawType[0] : rawType;
  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      const properties = (node['properties'] ?? {}) as Record<string, unknown>;
      const required = new Set(Array.isArray(node['required']) ? (node['required'] as string[]) : []);
      for (const [name, child] of Object.entries(properties)) {
        if (required.size > 0 && !required.has(name)) continue;
        out[name] = exampleFor(child, depth + 1);
      }
      return out;
    }
    case 'array':
      return node['items'] ? [exampleFor(node['items'], depth + 1)] : [];
    case 'string':
      return node['format'] === 'uri' ? 'https://example.com' : '';
    case 'number':
    case 'integer':
      return typeof node['minimum'] === 'number' ? node['minimum'] : 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}
