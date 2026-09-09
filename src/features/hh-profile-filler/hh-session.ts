import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { ProfileFillerError, profileFillerError } from './errors.ts'
import type { ResolvedClient } from './types.ts'

const require = createRequire(import.meta.url)
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const { startDolphinProfile, stopDolphinProfile } = require('../../integrations/dolphin/runtime.ts') as {
  startDolphinProfile(profileId: number): Promise<any>
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

export async function withAuthorizedHHPage<T>(client: ResolvedClient,
  action: (page: Page, artifactDir: string) => Promise<T>): Promise<T> {
  const artifactDir = artifactDirectory(client)
  fs.mkdirSync(artifactDir, { recursive: true })
  let browser: Browser | undefined
  let started = false
  try {
    const response = await startDolphinProfile(client.dolphinProfileId)
    started = true
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort(response)}`, {
      timeout: Number(process.env.CONNECT_OVER_CDP_TIMEOUT_MS ?? 60_000)
    })
    const context = browser.contexts()[0]
    if (!context) {
      throw profileFillerError('profile_dolphin_context_missing',
        'Dolphin CDP connection has no browser context.', 'start_dolphin')
    }
    const page = context.pages()[0] ?? await context.newPage()
    if (!/^https:\/\/([^/]+\.)?hh\.ru\//i.test(page.url())) {
      try {
        await page.goto('https://hh.ru/', { waitUntil: 'domcontentloaded', timeout: 120_000 })
      } catch (error) {
        // A Dolphin tab can finish the cross-domain commit while HH keeps a
        // subresource pending. Accept an already committed HH page; otherwise
        // retry with the weaker, sufficient navigation milestone.
        if (!/^https:\/\/([^/]+\.)?hh\.ru\//i.test(page.url())) {
          await page.goto('https://hh.ru/', { waitUntil: 'commit', timeout: 60_000 })
        }
      }
    }
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
    try {
      return await action(page, artifactDir)
    } catch (error) {
      if (error instanceof ProfileFillerError) {
        throw new ProfileFillerError(error.code, error.message, error.stage, {
          ...error.details,
          artifactDir
        })
      }
      throw error
    }
  } finally {
    await browser?.close().catch(() => undefined)
    if (started) await stopDolphinProfile(client.dolphinProfileId).catch(() => undefined)
  }
}
