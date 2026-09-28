import { defineConfig } from 'vitest/config';

/**
 * This package's tests boot an in-process PostgreSQL (PGlite) and, in some
 * suites, spawn real MCP server processes. Vitest's default worker pool would
 * multiply that cost by the number of cores, and several packages doing it at
 * once thrashes rather than parallelises. One forked process per package keeps
 * parallelism at the package level, where turbo already manages it.
 */
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
