import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/test/**/*.test.ts',
      'frontend/src/**/*.test.ts',
      'frontend/src/**/*.test.tsx',
    ],
    environmentMatchGlobs: [
      ['frontend/src/**', 'jsdom'],
    ],
    globals: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    // Test files share one process (singleFork) and several mutate the shared
    // process.env.BENCHY_DIR global in beforeAll/afterAll — concurrent file
    // scheduling can interleave those hooks and leak requests into the real
    // ~/.benchy directory. Force strictly sequential file execution.
    fileParallelism: false,
    setupFiles: ['frontend/src/test-setup.ts'],
  },
})
