import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // The module graph cannot see these: `@engy/common` is mostly type imports.
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      '**/common/src/**',
      '**/pnpm-lock.yaml',
    ],
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', '**/*.test.ts'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
