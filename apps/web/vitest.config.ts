import { defineConfig } from 'vitest/config';

/**
 * The dashboard has no Vitest suites — its behaviour is covered end to end by
 * Playwright. Without this exclusion Vitest would collect the specs in `e2e/`
 * and fail, because they are written against the Playwright runner.
 */
export default defineConfig({
  test: {
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**', 'test-results/**'],
    passWithNoTests: true,
  },
});
