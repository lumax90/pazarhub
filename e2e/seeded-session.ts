import { readFile } from 'node:fs/promises'
import type { BrowserContext, Page } from '@playwright/test'

/** Ephemeral test-only sessions created by the real registration flow during server startup. */
export async function useSeededSession(page: Page, email: string) {
  const sessions = JSON.parse(await readFile('.data/e2e-sessions.json', 'utf8')) as Record<
    string,
    Parameters<BrowserContext['addCookies']>[0]
  >
  if (!sessions[email]) throw new Error('Seeded browser test account is missing.')
  await page.context().addCookies(sessions[email])
}
