import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ObservedClientState, ProfileFillerJob, ProfileFillerMarket,
  ProfileFillerState } from './types.ts'

export const DEFAULT_WATERMARK = '2026-09-03T15:53:37+02:00'
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const TARGET_STATUS: Record<string, ProfileFillerMarket> = {
  'on ru market': 'Ru',
  'on en market': 'En'
}

function iso(value: unknown, fallback = new Date().toISOString()): string {
  const parsed = Date.parse(String(value ?? ''))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback
}

function normalizedStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function marketForStatus(value: unknown): ProfileFillerMarket | undefined {
  return TARGET_STATUS[normalizedStatus(value)]
}

export function emptyState(watermark = DEFAULT_WATERMARK): ProfileFillerState {
  return { version: 1, watermark: iso(watermark, DEFAULT_WATERMARK),
    observedClients: {}, jobs: [] }
}

export function defaultStatePath(): string {
  const repoRoot = path.resolve(moduleDir, '../../..')
  const storageRoot = process.env.PROFILE_FILLER_STORAGE_ROOT
    ? path.resolve(process.env.PROFILE_FILLER_STORAGE_ROOT)
    : path.join(repoRoot, 'storage', 'hh-profile-filler')
  return path.join(storageRoot, 'state.json')
}

export function readState(filePath = defaultStatePath()): ProfileFillerState {
  if (!fs.existsSync(filePath)) return emptyState()
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProfileFillerState
  if (value?.version !== 1 || !value.observedClients || !Array.isArray(value.jobs)) {
    throw new Error(`Unsupported HH profile filler state at ${filePath}`)
  }
  return value
}

export function writeState(state: ProfileFillerState, filePath = defaultStatePath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

type ClientStatusRow = { Id: number; client_name?: unknown; client_status?: unknown; UpdatedAt?: unknown }

function createJob(client: ClientStatusRow, market: ProfileFillerMarket,
  transitionAt: string, now: string): ProfileFillerJob {
  const stamp = iso(transitionAt, now)
  return { id: `${client.Id}:${market.toLowerCase()}:${stamp}`, clientId: client.Id,
    clientName: String(client.client_name ?? `client-${client.Id}`).trim(), market,
    transitionAt: stamp, createdAt: now, updatedAt: now, status: 'pending', attemptCount: 0 }
}

export function observeStatusTransitions(state: ProfileFillerState, clients: ClientStatusRow[],
  now = new Date().toISOString()): ProfileFillerJob[] {
  const created: ProfileFillerJob[] = []
  const initialized = Boolean(state.initializedAt)
  const watermarkMs = Date.parse(state.watermark)
  for (const client of clients) {
    const key = String(client.Id)
    const status = normalizedStatus(client.client_status)
    const updatedAt = iso(client.UpdatedAt, now)
    const previous: ObservedClientState | undefined = state.observedClients[key]
    const market = marketForStatus(status)
    const changed = previous && previous.status !== status
    const changedAfterWatermark = Date.parse(updatedAt) > watermarkMs
    if (market && ((initialized && changed) || (!initialized && changedAfterWatermark))) {
      const job = createJob(client, market, updatedAt, now)
      if (!state.jobs.some(existing => existing.id === job.id)) {
        state.jobs.push(job)
        created.push(job)
      }
    }
    state.observedClients[key] = { status, updatedAt }
  }
  state.initializedAt ||= now
  return created
}

export function eligibleJobs(state: ProfileFillerState,
  now = new Date().toISOString()): ProfileFillerJob[] {
  const nowMs = Date.parse(now)
  return state.jobs.filter(job => {
    if (job.status === 'pending' || job.status === 'dry_run_passed') return true
    if (job.status !== 'failed' || job.attemptCount >= 3) return false
    return !job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= nowMs
  })
}

export function markJobFailure(job: ProfileFillerJob, code: string, message: string,
  now = new Date().toISOString()): void {
  job.attemptCount += 1
  job.updatedAt = now
  job.lastErrorCode = code
  job.lastErrorMessage = message
  if (job.attemptCount >= 3) {
    job.status = 'exhausted'
    delete job.nextAttemptAt
    return
  }
  job.status = 'failed'
  job.nextAttemptAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString()
}

export function markDryRunPassed(job: ProfileFillerJob, artifact?: string): void {
  job.status = 'dry_run_passed'
  job.updatedAt = new Date().toISOString()
  job.dryRunArtifact = artifact
  delete job.lastErrorCode
  delete job.lastErrorMessage
}

export function markJobCompleted(job: ProfileFillerJob, artifact?: string): void {
  job.status = 'completed'
  job.updatedAt = new Date().toISOString()
  job.resultArtifact = artifact
  delete job.nextAttemptAt
  delete job.lastErrorCode
  delete job.lastErrorMessage
}
