import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/test/**/*.test.ts',
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
    setupFiles: ['frontend/src/test-setup.ts'],
  },
})
