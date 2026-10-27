import { defineConfig, devices } from '@playwright/test'

const preview = process.env.E2E_PREVIEW === '1'
const baseURL = `http://localhost:${preview ? 4173 : 5173}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: preview ? 'npm run preview' : 'npm run dev',
      url: baseURL,
      reuseExistingServer: true,
      timeout: 60000,
    },
    {
      command: 'node --import tsx scripts/e2e-server.ts',
      url: 'http://localhost:4174/api/health',
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
})
