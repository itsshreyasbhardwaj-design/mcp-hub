import { contextLogger } from './context.js';

/**
 * Minimal in-process timing helper. Durations are logged as structured fields
 * so they can be aggregated by whatever log pipeline the deployment uses; the
 * product's own analytics live in the database, not here.
 */
export async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  fields: Record<string, unknown> = {},
): Promise<T> {
  const started = performance.now();
  try {
    const result = await fn();
    contextLogger().debug(`${name} ok`, {
      ...fields,
      durationMs: Math.round(performance.now() - started),
    });
    return result;
  } catch (err) {
    contextLogger().warn(`${name} failed`, {
      ...fields,
      durationMs: Math.round(performance.now() - started),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
