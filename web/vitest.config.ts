import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/server/**/*.test.ts', 'src/lib/**/*.test.ts', 'src/components/**/*.test.ts'],
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
