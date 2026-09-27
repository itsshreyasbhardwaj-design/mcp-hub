// Flat ESLint config shared by every workspace package.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // `any` is banned outside of narrowly-scoped, commented escape hatches.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Import safeFetch from @mcp-hub/security for outbound requests.' },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'scripts/**', 'examples/**', 'tests/**'],
    rules: { 'no-console': 'off', 'no-restricted-globals': 'off' },
  },
);
