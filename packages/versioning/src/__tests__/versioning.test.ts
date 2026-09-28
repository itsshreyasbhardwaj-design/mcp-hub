import { describe, expect, it } from 'vitest';
import { diffSchemas } from '../schema-diff.js';
import { diffVersions, summarizeDiff } from '../diff.js';
import { compareVersions, parseVersion, sortVersionsDescending, suggestedBump } from '../semver.js';
import type { CapabilitySnapshot, SnapshotTool } from '../snapshot.js';

const tool = (overrides: Partial<SnapshotTool> = {}): SnapshotTool => ({
  name: 'do_thing',
  description: 'Does a thing.',
  inputSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
  outputSchema: null,
  riskClass: 'WRITE',
  ...overrides,
});

const snapshot = (overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot => ({
  version: '1.0.0',
  protocolVersion: '2025-06-18',
  capabilities: { tools: {} },
  tools: [tool()],
  resources: [],
  prompts: [],
  ...overrides,
});

describe('schema diffing', () => {
  it('treats a new required property as breaking', () => {
    const changes = diffSchemas(
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a', 'b'],
      },
    );
    const added = changes.find((c) => c.rule === 'schema.required-property-added');
    expect(added?.breaking).toBe(true);
  });

  it('treats a new optional property as non-breaking', () => {
    const changes = diffSchemas(
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'string' } },
        required: ['a'],
      },
    );
    const added = changes.find((c) => c.rule === 'schema.optional-property-added');
    expect(added?.breaking).toBe(false);
  });

  it('treats a removed property as breaking', () => {
    const changes = diffSchemas(
      { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
      { type: 'object', properties: { a: { type: 'string' } } },
    );
    expect(changes.find((c) => c.rule === 'schema.property-removed')?.breaking).toBe(true);
  });

  it('treats an existing property becoming required as breaking', () => {
    const changes = diffSchemas(
      { type: 'object', properties: { a: { type: 'string' } }, required: [] },
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
    );
    expect(changes.find((c) => c.rule === 'schema.required-added')?.breaking).toBe(true);
  });

  it('treats a property becoming optional as non-breaking', () => {
    const changes = diffSchemas(
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      { type: 'object', properties: { a: { type: 'string' } }, required: [] },
    );
    expect(changes.find((c) => c.rule === 'schema.required-removed')?.breaking).toBe(false);
  });

  it('distinguishes a widened type from a changed one', () => {
    const widened = diffSchemas({ type: 'string' }, { type: ['string', 'number'] });
    expect(widened.find((c) => c.rule === 'schema.type-widened')?.breaking).toBe(false);

    const changed = diffSchemas({ type: 'string' }, { type: 'number' });
    expect(changed.find((c) => c.rule === 'schema.type-changed')?.breaking).toBe(true);
  });

  it('treats a narrowed enum as breaking and a widened one as safe', () => {
    const narrowed = diffSchemas({ enum: ['a', 'b', 'c'] }, { enum: ['a', 'b'] });
    expect(narrowed.find((c) => c.rule === 'schema.enum-narrowed')?.breaking).toBe(true);

    const widened = diffSchemas({ enum: ['a'] }, { enum: ['a', 'b'] });
    expect(widened.find((c) => c.rule === 'schema.enum-widened')?.breaking).toBe(false);
  });

  it('treats a tightened numeric constraint as breaking', () => {
    const tightened = diffSchemas({ type: 'number', minimum: 0 }, { type: 'number', minimum: 10 });
    expect(tightened.find((c) => c.rule === 'schema.constraint-tightened')?.breaking).toBe(true);

    const relaxed = diffSchemas({ type: 'number', minimum: 10 }, { type: 'number', minimum: 0 });
    expect(relaxed.find((c) => c.rule === 'schema.constraint-relaxed')?.breaking).toBe(false);
  });

  it('treats forbidding additional properties as breaking', () => {
    const changes = diffSchemas(
      { type: 'object' },
      { type: 'object', additionalProperties: false },
    );
    expect(changes.find((c) => c.rule === 'schema.additional-properties-forbidden')?.breaking).toBe(
      true,
    );
  });

  it('reports a description change without calling it breaking', () => {
    const changes = diffSchemas({ description: 'old' }, { description: 'new' });
    expect(changes[0]?.kind).toBe('description-changed');
    expect(changes[0]?.breaking).toBe(false);
  });

  it('reports nothing for identical schemas', () => {
    const schema = { type: 'object', properties: { a: { type: 'string', description: 'x' } } };
    expect(diffSchemas(schema, structuredClone(schema))).toEqual([]);
  });

  it('cites a rule for every change it reports', () => {
    const changes = diffSchemas(
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      { type: 'object', properties: { a: { type: 'number' } }, required: [] },
    );
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) {
      expect(change.rule).toBeTruthy();
      expect(change.detail.length).toBeGreaterThan(10);
    }
  });
});

describe('version diffing', () => {
  it('reports an added tool as non-breaking', () => {
    const diff = diffVersions(
      snapshot(),
      snapshot({ version: '1.1.0', tools: [tool(), tool({ name: 'new_thing' })] }),
    );
    expect(diff.toolsAdded).toBe(1);
    expect(diff.breakingChanges).toBe(0);
  });

  it('reports a removed tool as breaking', () => {
    const diff = diffVersions(snapshot(), snapshot({ version: '2.0.0', tools: [] }));
    expect(diff.toolsRemoved).toBe(1);
    expect(diff.breakingChanges).toBeGreaterThan(0);
    expect(diff.changes[0]?.rule).toBe('tool.removed');
  });

  it('infers a rename from an identical input schema', () => {
    const diff = diffVersions(
      snapshot(),
      snapshot({ version: '2.0.0', tools: [tool({ name: 'do_thing_v2' })] }),
    );
    expect(diff.toolsRenamed).toBe(1);
    expect(diff.toolsRemoved).toBe(0);
    expect(diff.toolsAdded).toBe(0);
    const rename = diff.changes.find((c) => c.kind === 'tool_renamed');
    expect(rename?.breaking).toBe(true);
    expect(rename?.detail).toMatch(/appears to have been renamed/);
  });

  it('does not infer a rename when the schema also changed', () => {
    const diff = diffVersions(
      snapshot(),
      snapshot({
        version: '2.0.0',
        tools: [
          tool({
            name: 'do_thing_v2',
            inputSchema: { type: 'object', properties: { z: { type: 'number' } } },
          }),
        ],
      }),
    );
    expect(diff.toolsRenamed).toBe(0);
    expect(diff.toolsRemoved).toBe(1);
    expect(diff.toolsAdded).toBe(1);
  });

  it('reports a risk reclassification', () => {
    const diff = diffVersions(
      snapshot(),
      snapshot({ version: '1.1.0', tools: [tool({ riskClass: 'DESTRUCTIVE' })] }),
    );
    const change = diff.changes.find((c) => c.kind === 'risk_changed');
    expect(change?.detail).toMatch(/WRITE to DESTRUCTIVE/);
  });

  it('reports a removed capability as breaking', () => {
    const diff = diffVersions(snapshot(), snapshot({ version: '2.0.0', capabilities: {} }));
    const change = diff.changes.find((c) => c.rule === 'capability.removed');
    expect(change?.breaking).toBe(true);
  });

  it('reports a removed resource and a new required prompt argument', () => {
    const before = snapshot({
      resources: [{ uri: 'x://a', name: 'a', mimeType: null }],
      prompts: [{ name: 'p', description: null, arguments: [] }],
    });
    const after = snapshot({
      version: '2.0.0',
      resources: [],
      prompts: [{ name: 'p', description: null, arguments: [{ name: 'style', required: true }] }],
    });
    const diff = diffVersions(before, after);
    expect(diff.changes.some((c) => c.rule === 'resource.removed' && c.breaking)).toBe(true);
    expect(
      diff.changes.some((c) => c.rule === 'prompt.required-argument-added' && c.breaking),
    ).toBe(true);
  });

  it('sorts breaking changes first', () => {
    const diff = diffVersions(
      snapshot({ tools: [tool(), tool({ name: 'keep_me' })] }),
      snapshot({
        version: '2.0.0',
        tools: [tool({ name: 'keep_me' }), tool({ name: 'brand_new' })],
      }),
    );
    expect(diff.changes[0]?.breaking).toBe(true);
  });

  it('summarises a diff in one line', () => {
    const diff = diffVersions(snapshot(), snapshot({ version: '2.0.0', tools: [] }));
    expect(summarizeDiff(diff)).toMatch(/-1 tool.*1 breaking/);
    expect(summarizeDiff(diffVersions(snapshot(), snapshot()))).toBe('No capability changes.');
  });
});

describe('version ordering', () => {
  it('parses semver', () => {
    expect(parseVersion('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3, isSemver: true });
    expect(parseVersion('v2.0')).toMatchObject({ major: 2, minor: 0, patch: 0, isSemver: true });
    expect(parseVersion('2024-06-18')).toMatchObject({ isSemver: false });
  });

  it('orders releases correctly', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('sorts a prerelease before its release', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeLessThan(0);
  });

  it('never throws on a non-semver tag', () => {
    expect(() => compareVersions('nightly', '1.0.0')).not.toThrow();
    const sorted = sortVersionsDescending(
      [{ v: '1.0.0' }, { v: 'nightly' }, { v: '2.0.0' }],
      (item) => item.v,
    );
    expect(sorted[0]?.v).toBe('2.0.0');
  });

  it('suggests a bump from the observed changes', () => {
    expect(suggestedBump(1, 0)).toBe('major');
    expect(suggestedBump(0, 2)).toBe('minor');
    expect(suggestedBump(0, 0)).toBe('patch');
  });
});
