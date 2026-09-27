import { getConfig, type HubConfig } from '@mcp-hub/config';
import {
  AnalyticsRepository,
  ApiKeyRepository,
  AuditRepository,
  GovernanceRepository,
  IdentityRepository,
  JobRepository,
  RegistryRepository,
  SearchRepository,
  SecretRepository,
  SessionRepository,
  getDatabase,
  type SqlDriver,
} from '@mcp-hub/database';
import { PostgresSearchProvider, type SearchProvider } from '@mcp-hub/search';
import { selectProvider, type LlmProvider } from '@mcp-hub/assistant';

export interface Repositories {
  identity: IdentityRepository;
  registry: RegistryRepository;
  governance: GovernanceRepository;
  audit: AuditRepository;
  apiKeys: ApiKeyRepository;
  analytics: AnalyticsRepository;
  search: SearchRepository;
  secrets: SecretRepository;
  sessions: SessionRepository;
  jobs: JobRepository;
}

export interface AppContext {
  config: HubConfig;
  db: SqlDriver;
  repositories: Repositories;
  searchProvider: SearchProvider;
  llm: LlmProvider;
}

export function buildRepositories(db: SqlDriver): Repositories {
  return {
    identity: new IdentityRepository(db),
    registry: new RegistryRepository(db),
    governance: new GovernanceRepository(db),
    audit: new AuditRepository(db),
    apiKeys: new ApiKeyRepository(db),
    analytics: new AnalyticsRepository(db),
    search: new SearchRepository(db),
    secrets: new SecretRepository(db),
    sessions: new SessionRepository(db),
    jobs: new JobRepository(db),
  };
}

export function buildContext(db: SqlDriver, config = getConfig()): AppContext {
  const repositories = buildRepositories(db);
  return {
    config,
    db,
    repositories,
    searchProvider: new PostgresSearchProvider(repositories.search, db.capabilities),
    llm: selectProvider(config),
  };
}

// Cached on globalThis so Next.js hot reloads reuse one embedded database.
const CONTEXT_KEY = Symbol.for('mcp-hub.context');
const globalCache = globalThis as unknown as Record<symbol, Promise<AppContext> | undefined>;

export function getContext(): Promise<AppContext> {
  globalCache[CONTEXT_KEY] ??= getDatabase()
    .then((db) => buildContext(db))
    .catch((err: unknown) => {
      delete globalCache[CONTEXT_KEY];
      throw err;
    });
  return globalCache[CONTEXT_KEY];
}

/** Test helper: replaces the process-wide context with one built on `db`. */
export function setTestContext(db: SqlDriver, config?: HubConfig): AppContext {
  const context = buildContext(db, config);
  globalCache[CONTEXT_KEY] = Promise.resolve(context);
  return context;
}

export function resetContext(): void {
  delete globalCache[CONTEXT_KEY];
}
