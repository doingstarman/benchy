import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// vitest 4 removed `environmentMatchGlobs`; the node-vs-jsdom split now lives in two
// projects. The node project stays single-fork and strictly sequential — several
// backend test files mutate the shared process.env.BENCHY_DIR in beforeAll/afterAll,
// so interleaving them would leak requests into the real ~/.benchy directory.
export default defineConfig({
  test: {
    globals: false,
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'src/test/**/*.test.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          fileParallelism: false,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['frontend/src/**/*.test.ts', 'frontend/src/**/*.test.tsx'],
          setupFiles: ['frontend/src/test-setup.ts'],
        },
      },
    ],
  },
})
