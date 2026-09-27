import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Logger } from './logger.js';
import { logger as rootLogger } from './logger.js';

export interface RequestContext {
  requestId: string;
  organizationId?: string;
  userId?: string;
  route?: string;
  startedAt: number;
  logger: Logger;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function newRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/** Runs `fn` with an ambient request context available to every nested call. */
export function runWithContext<T>(
  seed: Omit<Partial<RequestContext>, 'logger' | 'startedAt'>,
  fn: (ctx: RequestContext) => T,
): T {
  const requestId = seed.requestId ?? newRequestId();
  const ctx: RequestContext = {
    ...seed,
    requestId,
    startedAt: Date.now(),
    logger: rootLogger.child({
      requestId,
      ...(seed.organizationId ? { organizationId: seed.organizationId } : {}),
      ...(seed.userId ? { userId: seed.userId } : {}),
      ...(seed.route ? { route: seed.route } : {}),
    }),
  };
  return storage.run(ctx, () => fn(ctx));
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The ambient request logger, or the root logger outside a request. */
export function contextLogger(): Logger {
  return storage.getStore()?.logger ?? rootLogger;
}

export function currentRequestId(): string {
  return storage.getStore()?.requestId ?? 'req_none';
}
