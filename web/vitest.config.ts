import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    // Workspace-creating hooks (fresh ENGY_DIR + git init) can exceed the 10s
    // default under full-suite parallel load — see m7-validation.md Phase 1.
    hookTimeout: 30_000,
    // Suppress qmd model initialisation in all tests by default. Individual test
    // files that need real qmd search (search.test.ts) clear this flag selectively.
    env: { QMD_SKIP: '1' },
    include: [
      'src/server/**/*.test.ts',
      'src/lib/**/*.test.ts',
      'src/components/**/*.test.ts',
      'src/hooks/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/server/**/*.ts'],
      exclude: ['src/server/db/migrations/**', 'src/server/db/migrate.ts', 'src/server/db/schema.ts', '**/*.test.ts', '**/test-helpers.ts'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
