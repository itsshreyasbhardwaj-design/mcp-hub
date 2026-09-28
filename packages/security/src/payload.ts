import { HubError } from '@mcp-hub/core';

/**
 * Guards against oversized payloads in both directions. A hostile MCP server
 * returning a multi-gigabyte result must not be able to exhaust memory, and a
 * client must not be able to push one through the API.
 */
export function assertPayloadWithinLimit(value: unknown, maxBytes: number, label: string): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxBytes) {
    throw new HubError('PAYLOAD_TOO_LARGE', `${label} exceeds the ${maxBytes} byte limit.`, {
      details: { bytes, maxBytes },
    });
  }
  return serialized;
}

export function byteLength(value: unknown): number {
  return Buffer.byteLength(
    typeof value === 'string' ? value : JSON.stringify(value ?? null),
    'utf8',
  );
}

/**
 * Caps the depth and breadth of a decoded JSON value. Deeply nested
 * structures are cheap to produce and expensive to process downstream.
 */
export function assertStructureWithinLimits(
  value: unknown,
  options: { maxDepth?: number; maxNodes?: number } = {},
): void {
  const maxDepth = options.maxDepth ?? 32;
  const maxNodes = options.maxNodes ?? 50_000;
  let nodes = 0;

  const walk = (node: unknown, depth: number): void => {
    if (depth > maxDepth) {
      throw new HubError('PAYLOAD_TOO_LARGE', `Payload nests deeper than ${maxDepth} levels.`);
    }
    nodes += 1;
    if (nodes > maxNodes) {
      throw new HubError('PAYLOAD_TOO_LARGE', `Payload contains more than ${maxNodes} values.`);
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (node && typeof node === 'object') {
      for (const child of Object.values(node)) walk(child, depth + 1);
    }
  };

  walk(value, 0);
}
