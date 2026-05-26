import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15000,
    include: ['spec/**/*.spec.ts'],
    globalSetup: ['spec/setup.ts'],
    fileParallelism: false,
  },
});
