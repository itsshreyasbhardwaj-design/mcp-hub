import type { JsonSchema } from '@mcp-hub/core';

/**
 * Schema comparison with explicit, documented rules.
 *
 * "Breaking" here means: a call that was valid against the old schema may be
 * rejected by the new one, or a caller relying on the old shape will now be
 * wrong. Every classification below cites the rule that produced it, so a
 * reviewer can disagree with the rule rather than with an opaque verdict.
 */
export interface SchemaChange {
  path: string;
  kind:
    | 'property-added'
    | 'property-removed'
    | 'property-type-changed'
    | 'required-added'
    | 'required-removed'
    | 'enum-narrowed'
    | 'enum-widened'
    | 'constraint-tightened'
    | 'constraint-relaxed'
    | 'description-changed';
  before: unknown;
  after: unknown;
  breaking: boolean;
  rule: string;
  detail: string;
}

const NUMERIC_TIGHTENING: Array<[string, 'increase' | 'decrease']> = [
  ['minimum', 'increase'],
  ['exclusiveMinimum', 'increase'],
  ['minLength', 'increase'],
  ['minItems', 'increase'],
  ['maximum', 'decrease'],
  ['exclusiveMaximum', 'decrease'],
  ['maxLength', 'decrease'],
  ['maxItems', 'decrease'],
];

export function diffSchemas(before: unknown, after: unknown, path = '$'): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const a = asSchema(before);
  const b = asSchema(after);
  if (!a && !b) return changes;

  if (!a || !b) {
    changes.push({
      path,
      kind: a ? 'property-removed' : 'property-added',
      before,
      after,
      breaking: Boolean(a),
      rule: a ? 'schema.removed' : 'schema.added',
      detail: a ? 'The schema was removed.' : 'A schema was added where there was none.',
    });
    return changes;
  }

  compareTypes(a, b, path, changes);
  compareProperties(a, b, path, changes);
  compareRequired(a, b, path, changes);
  compareEnums(a, b, path, changes);
  compareConstraints(a, b, path, changes);

  if (a['description'] !== b['description']) {
    changes.push({
      path: `${path}.description`,
      kind: 'description-changed',
      before: a['description'] ?? null,
      after: b['description'] ?? null,
      breaking: false,
      rule: 'schema.description-changed',
      detail: 'Documentation changed. Models may select the field differently.',
    });
  }

  const aItems = asSchema(a['items']);
  const bItems = asSchema(b['items']);
  if (aItems || bItems) changes.push(...diffSchemas(a['items'], b['items'], `${path}.items`));

  return changes;
}

function asSchema(value: unknown): JsonSchema | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonSchema) : null;
}

function typeOf(schema: JsonSchema): string {
  const type = schema['type'];
  if (Array.isArray(type)) return [...type].map(String).sort().join('|');
  if (typeof type === 'string') return type;
  if (schema['enum']) return 'enum';
  return 'unknown';
}

function compareTypes(a: JsonSchema, b: JsonSchema, path: string, changes: SchemaChange[]): void {
  const beforeType = typeOf(a);
  const afterType = typeOf(b);
  if (beforeType === afterType) return;

  // Widening to a union that still accepts the old type is not breaking for
  // callers sending the old shape.
  const afterSet = new Set(afterType.split('|'));
  const widened = beforeType.split('|').every((t) => afterSet.has(t));
  changes.push({
    path: `${path}.type`,
    kind: 'property-type-changed',
    before: beforeType,
    after: afterType,
    breaking: !widened,
    rule: widened ? 'schema.type-widened' : 'schema.type-changed',
    detail: widened
      ? `Type widened from ${beforeType} to ${afterType}; existing calls remain valid.`
      : `Type changed from ${beforeType} to ${afterType}; existing calls may be rejected.`,
  });
}

function compareProperties(a: JsonSchema, b: JsonSchema, path: string, changes: SchemaChange[]): void {
  const beforeProps = (a['properties'] ?? {}) as Record<string, unknown>;
  const afterProps = (b['properties'] ?? {}) as Record<string, unknown>;
  const names = new Set([...Object.keys(beforeProps), ...Object.keys(afterProps)]);

  for (const name of names) {
    const inBefore = name in beforeProps;
    const inAfter = name in afterProps;
    const childPath = `${path}.properties.${name}`;

    if (inBefore && !inAfter) {
      changes.push({
        path: childPath,
        kind: 'property-removed',
        before: beforeProps[name],
        after: null,
        breaking: true,
        rule: 'schema.property-removed',
        detail: `Property "${name}" no longer exists; callers still sending it may be rejected.`,
      });
      continue;
    }
    if (!inBefore && inAfter) {
      const required = Array.isArray(b['required']) && (b['required'] as string[]).includes(name);
      changes.push({
        path: childPath,
        kind: 'property-added',
        before: null,
        after: afterProps[name],
        breaking: required,
        rule: required ? 'schema.required-property-added' : 'schema.optional-property-added',
        detail: required
          ? `Required property "${name}" was added; existing calls will now fail.`
          : `Optional property "${name}" was added.`,
      });
      continue;
    }
    changes.push(...diffSchemas(beforeProps[name], afterProps[name], childPath));
  }
}

function compareRequired(a: JsonSchema, b: JsonSchema, path: string, changes: SchemaChange[]): void {
  const before = new Set(Array.isArray(a['required']) ? (a['required'] as string[]) : []);
  const after = new Set(Array.isArray(b['required']) ? (b['required'] as string[]) : []);

  for (const name of after) {
    if (before.has(name)) continue;
    const isNewProperty = !((a['properties'] ?? {}) as Record<string, unknown>)[name];
    if (isNewProperty) continue; // already reported as a required property addition
    changes.push({
      path: `${path}.required`,
      kind: 'required-added',
      before: [...before],
      after: [...after],
      breaking: true,
      rule: 'schema.required-added',
      detail: `"${name}" became required; calls that omitted it will now fail.`,
    });
  }
  for (const name of before) {
    if (after.has(name)) continue;
    if (!((b['properties'] ?? {}) as Record<string, unknown>)[name]) continue; // property removal already reported
    changes.push({
      path: `${path}.required`,
      kind: 'required-removed',
      before: [...before],
      after: [...after],
      breaking: false,
      rule: 'schema.required-removed',
      detail: `"${name}" is no longer required; existing calls remain valid.`,
    });
  }
}

function compareEnums(a: JsonSchema, b: JsonSchema, path: string, changes: SchemaChange[]): void {
  const before = Array.isArray(a['enum']) ? (a['enum'] as unknown[]) : null;
  const after = Array.isArray(b['enum']) ? (b['enum'] as unknown[]) : null;
  if (!before && !after) return;

  if (before && !after) {
    changes.push({
      path: `${path}.enum`,
      kind: 'enum-widened',
      before,
      after: null,
      breaking: false,
      rule: 'schema.enum-removed',
      detail: 'The value is no longer restricted to an enumeration.',
    });
    return;
  }
  if (!before && after) {
    changes.push({
      path: `${path}.enum`,
      kind: 'enum-narrowed',
      before: null,
      after,
      breaking: true,
      rule: 'schema.enum-added',
      detail: 'The value is now restricted to an enumeration; previously valid values may be rejected.',
    });
    return;
  }
  if (!before || !after) return;

  const beforeSet = new Set(before.map((v) => JSON.stringify(v)));
  const afterSet = new Set(after.map((v) => JSON.stringify(v)));
  const removed = [...beforeSet].filter((v) => !afterSet.has(v));
  const added = [...afterSet].filter((v) => !beforeSet.has(v));

  if (removed.length > 0) {
    changes.push({
      path: `${path}.enum`,
      kind: 'enum-narrowed',
      before,
      after,
      breaking: true,
      rule: 'schema.enum-narrowed',
      detail: `Removed permitted value(s): ${removed.join(', ')}.`,
    });
  }
  if (added.length > 0) {
    changes.push({
      path: `${path}.enum`,
      kind: 'enum-widened',
      before,
      after,
      breaking: false,
      rule: 'schema.enum-widened',
      detail: `Added permitted value(s): ${added.join(', ')}.`,
    });
  }
}

function compareConstraints(a: JsonSchema, b: JsonSchema, path: string, changes: SchemaChange[]): void {
  for (const [keyword, tighteningDirection] of NUMERIC_TIGHTENING) {
    const before = a[keyword];
    const after = b[keyword];
    if (before === after) continue;
    if (typeof before !== 'number' && typeof after !== 'number') continue;

    const tightened =
      typeof after === 'number' &&
      (typeof before !== 'number' ||
        (tighteningDirection === 'increase' ? after > before : after < before));

    changes.push({
      path: `${path}.${keyword}`,
      kind: tightened ? 'constraint-tightened' : 'constraint-relaxed',
      before: before ?? null,
      after: after ?? null,
      breaking: tightened,
      rule: tightened ? 'schema.constraint-tightened' : 'schema.constraint-relaxed',
      detail: tightened
        ? `"${keyword}" became stricter; previously valid values may be rejected.`
        : `"${keyword}" became more permissive.`,
    });
  }

  if (a['pattern'] !== b['pattern'] && (a['pattern'] || b['pattern'])) {
    changes.push({
      path: `${path}.pattern`,
      kind: b['pattern'] ? 'constraint-tightened' : 'constraint-relaxed',
      before: a['pattern'] ?? null,
      after: b['pattern'] ?? null,
      breaking: Boolean(b['pattern']),
      rule: 'schema.pattern-changed',
      detail: b['pattern']
        ? 'The accepted pattern changed; previously valid values may be rejected.'
        : 'The pattern restriction was removed.',
    });
  }

  const beforeAdditional = a['additionalProperties'];
  const afterAdditional = b['additionalProperties'];
  if (beforeAdditional !== afterAdditional && afterAdditional === false) {
    changes.push({
      path: `${path}.additionalProperties`,
      kind: 'constraint-tightened',
      before: beforeAdditional ?? null,
      after: false,
      breaking: true,
      rule: 'schema.additional-properties-forbidden',
      detail: 'Extra properties are now rejected; callers sending them will fail.',
    });
  }
}
