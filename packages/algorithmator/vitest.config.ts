import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['spec/**/*.spec.ts'],
    environment: 'happy-dom',
    setupFiles: ['spec/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});
