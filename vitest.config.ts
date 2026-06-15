import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/test/**/*.test.ts'],
    globals: false,
    // Each test file gets its own port and temp dir — run sequentially to avoid port conflicts
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
