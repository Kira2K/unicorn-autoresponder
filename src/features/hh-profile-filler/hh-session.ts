import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page,
  type Request, type Response } from 'playwright'
import { ProfileFillerError, profileFillerError, safeErrorMessage } from './errors.ts'
import type { ResolvedClient } from './types.ts'

const require = createRequire(import.meta.url)
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const { startDolphinProfile, stopDolphinProfile } = require('../../integrations/dolphin/runtime.ts') as {
  startDolphinProfile(profileId: number, options?: { headless?: boolean }): Promise<any>
  stopDolphinProfile(profileId: number): Promise<void>
}
const { authorizeHHPage, validateAuth, HHAuthError } = require('../hh-responses/hh-auth/index.ts') as {
  authorizeHHPage(page: Page, options: any): Promise<any>
  validateAuth(page: Page, options?: any): Promise<any>
  HHAuthError: any
}

export function artifactDirectory(client: ResolvedClient, runId = new Date().toISOString()
  .replace(/[:.]/g, '-')): string {
  const root = process.env.PROFILE_FILLER_ARTIFACT_ROOT
    ? path.resolve(process.env.PROFILE_FILLER_ARTIFACT_ROOT)
    : path.resolve(moduleDir, '../../../logs/hh-profile-filler')
  return path.join(root, `${runId}-${client.clientId}-${client.market.toLowerCase()}`)
}

function cdpPort(response: any): number {
  const port = Number(response?.automation?.port)
  if (!Number.isInteger(port) || port <= 0) {
    throw profileFillerError('profile_dolphin_cdp_missing',
      'Dolphin did not return a Playwright CDP port.', 'start_dolphin')
  }
  return port
}

function mapAuthError(error: any): never {
  if (error instanceof ProfileFillerError) throw error
  const code = String(error?.code ?? '')
  if (code === 'captcha_detected') {
    throw profileFillerError('profile_hh_captcha', 'HH captcha was detected.', 'authenticate')
  }
  if (code === 'invalid_credentials' || code === 'login_failed') {
    throw profileFillerError('profile_hh_credentials_rejected',
      'HH rejected the configured login or password.', 'authenticate')
  }
  throw profileFillerError(code || 'profile_hh_auth_failed',
    String(error?.message ?? error), 'authenticate')
}

function isHHUrl(value: string): boolean {
  return /^https:\/\/([^/]+\.)?hh\.ru\//i.test(value)
}

async function hasUsableHHDocument(page: Page): Promise<boolean> {
  if (page.isClosed() || !isHHUrl(page.url())) return false
  return await page.evaluate(() => document.readyState !== 'loading' &&
    Boolean(document.body?.innerText.trim().length && document.documentElement?.children.length))
    .catch(() => false)
}

async function navigateToHH(page: Page): Promise<boolean> {
  const targets = ['https://hh.ru/applicant/resumes', 'https://hh.ru/']
  for (const target of targets) {
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    } catch {
      if (isHHUrl(page.url())) {
        await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
          .catch(() => undefined)
      } else {
        await page.goto(target, { waitUntil: 'commit', timeout: 60_000 })
          .catch(() => undefined)
      }
    }
    if (await hasUsableHHDocument(page)) return true
    await page.waitForTimeout(2_000)
  }
  return false
}

async function selectUsableHHPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages().filter(page => !page.isClosed())
  for (const candidate of pages) {
    if (await hasUsableHHDocument(candidate)) return candidate
  }

  let page = pages.find(candidate => isHHUrl(candidate.url())) ?? pages[0] ?? await context.newPage()
  if (isHHUrl(page.url())) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 }).catch(() => undefined)
  } else {
    await navigateToHH(page)
  }
  if (await hasUsableHHDocument(page)) return page

  // A stale Dolphin tab can report an HH URL while its renderer contains an
  // empty document. A fresh tab in the same context keeps the authorized
  // profile session without inheriting the broken renderer.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    page = await context.newPage()
    if (await navigateToHH(page)) return page
    await page.close().catch(() => undefined)
  }
  throw profileFillerError('profile_hh_navigation_failed',
    'HH closed the connection or returned an empty document after three fresh-tab retries.',
    'open_hh')
}

type FailureTelemetry = {
  failedRequests: Array<{ method: string; host: string; path: string; status?: number;
    resourceType?: string; error?: string }>
  pageErrors: string[]
}

function safeRequest(request: Request, status?: number) {
  let parsed: URL | undefined
  try { parsed = new URL(request.url()) } catch { /* keep sanitized fallback */ }
  return {
    method: request.method(), host: parsed?.hostname ?? 'invalid', path: parsed?.pathname ?? '/',
    status, resourceType: request.resourceType(),
    error: request.failure()?.errorText ? safeErrorMessage(request.failure()?.errorText) : undefined
  }
}

function observeFailures(page: Page): FailureTelemetry {
  const telemetry: FailureTelemetry = { failedRequests: [], pageErrors: [] }
  const add = (item: FailureTelemetry['failedRequests'][number]) => {
    if (telemetry.failedRequests.length < 40) telemetry.failedRequests.push(item)
  }
  page.on('response', (response: Response) => {
    if (response.status() >= 400) add(safeRequest(response.request(), response.status()))
  })
  page.on('requestfailed', request => add(safeRequest(request)))
  page.on('pageerror', error => {
    if (telemetry.pageErrors.length < 20) telemetry.pageErrors.push(safeErrorMessage(error))
  })
  return telemetry
}

async function captureFailure(page: Page, artifactDir: string, error: unknown,
  telemetry: FailureTelemetry): Promise<string> {
  const screenshot = path.join(artifactDir, 'failure.png')
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined)
  const visibleErrors = await page.locator([
    '[data-qa="snackbar"]:visible', '[data-qa*="error"]:visible', '[role="alert"]:visible'
  ].join(',')).allInnerTexts().catch(() => [])
  let current: URL | undefined
  try { current = new URL(page.url()) } catch { /* preserve sanitized fallback */ }
  const diagnostic = path.join(artifactDir, 'failure.json')
  fs.writeFileSync(diagnostic, `${JSON.stringify({
    error: safeErrorMessage(error),
    url: current ? `${current.origin}${current.pathname}` : 'invalid',
    title: await page.title().catch(() => ''),
    screen: await page.locator('[data-qa*="resume-profile-screen"]:visible').first()
      .getAttribute('data-qa').catch(() => undefined),
    visibleErrors: visibleErrors.map(value => value.trim()).filter(Boolean).slice(0, 20),
    failedRequests: telemetry.failedRequests,
    pageErrors: telemetry.pageErrors
  }, null, 2)}\n`, { mode: 0o600 })
  return diagnostic
}

export async function withAuthorizedHHPage<T>(client: ResolvedClient,
  action: (page: Page, artifactDir: string) => Promise<T>): Promise<T> {
  const artifactDir = artifactDirectory(client)
  fs.mkdirSync(artifactDir, { recursive: true })
  let browser: Browser | undefined
  let started = false
  let page: Page | undefined
  let telemetry: FailureTelemetry | undefined
  try {
    const response = await startDolphinProfile(client.dolphinProfileId, { headless: false })
    started = true
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort(response)}`, {
      timeout: Number(process.env.CONNECT_OVER_CDP_TIMEOUT_MS ?? 60_000)
    })
    const context = browser.contexts()[0]
    if (!context) {
      throw profileFillerError('profile_dolphin_context_missing',
        'Dolphin CDP connection has no browser context.', 'start_dolphin')
    }
    page = await selectUsableHHPage(context)
    telemetry = observeFailures(page)
    const initial = await validateAuth(page, { timeoutMs: 10_000 })
    if (initial.state === 'captcha') {
      throw profileFillerError('profile_hh_captcha', 'HH captcha was detected.', 'authenticate')
    }
    if (initial.state !== 'logged_in' && (!client.credentials.login || !client.credentials.password)) {
      throw profileFillerError('profile_hh_credentials_missing',
        `HH ${client.market} credentials are missing and the stored session is not authorized.`,
        'authenticate')
    }
    try {
      await authorizeHHPage(page, {
        credentials: client.credentials.login && client.credentials.password ? {
          email: client.credentials.login,
          password: client.credentials.password
        } : undefined,
        artifactDir,
        errorArtifactDir: artifactDir,
        timeoutMs: Number(process.env.HH_AUTH_TIMEOUT_MS ?? 30_000)
      })
    } catch (error: any) {
      if (error instanceof HHAuthError || error?.code) mapAuthError(error)
      throw error
    }
    return await action(page, artifactDir)
  } catch (error) {
    const diagnostic = page && telemetry
      ? await captureFailure(page, artifactDir, error, telemetry).catch(() => undefined)
      : undefined
    if (error instanceof ProfileFillerError) {
      throw new ProfileFillerError(error.code, error.message, error.stage, {
        ...error.details, artifactDir, diagnostic
      })
    }
    throw error
  } finally {
    await browser?.close().catch(() => undefined)
    if (started) await stopDolphinProfile(client.dolphinProfileId).catch(() => undefined)
  }
}
