import type { MonitorJob } from './types.ts'
import { recoveryWakeAt } from '../action-recovery.ts'

export function nextMonitorActionAt(job: MonitorJob, verificationAt?: string, now = Date.now()) {
  const pending = job.state.items.filter(item => ['publishing', 'uncertain'].includes(item.status)).length
  const maySend = !['disabled', 'completed', 'error'].includes(job.status) && now < Date.parse(job.expiresAt) &&
    job.state.published + pending < 30
  const times = [maySend ? job.state.nextWorkAt : undefined, verificationAt].filter(Boolean)
    .map(value => Date.parse(value!)).filter(Number.isFinite)
  let next = times.length ? Math.max(Math.min(...times), Date.parse(job.state.providerNotBefore ?? '') || 0) : Infinity
  for (const item of job.state.items) if (['detected', 'generating', 'queued', 'publishing', 'uncertain'].includes(item.status))
    next = recoveryWakeAt(item.recovery, next)
  for (const value of Object.values(job.state.readRecovery ?? {})) next = recoveryWakeAt(value, next)
  return Number.isFinite(next) ? new Date(next).toISOString() : undefined
}

export const DAY_MS = 24 * 60 * 60 * 1_000
export const SESSION_MS = 2 * DAY_MS

export function randomBetween(min: number, max: number, random = Math.random) {
  return Math.round(min + (max - min) * Math.min(1, Math.max(0, random())))
}

export function nextCheckDelay(elapsedMs: number, random = Math.random) {
  return elapsedMs < DAY_MS
    ? randomBetween(25 * 60_000, 35 * 60_000, random)
    : randomBetween(120 * 60_000, 150 * 60_000, random)
}

export function replyDelay(random = Math.random) {
  return randomBetween(45_000, 120_000, random)
}

export function nextCheckAt(startedAt: string, nowMs = Date.now(), random = Math.random) {
  const expiresAt = Date.parse(startedAt) + SESSION_MS
  if (nowMs >= expiresAt) return undefined
  return new Date(Math.min(expiresAt, nowMs + nextCheckDelay(nowMs - Date.parse(startedAt), random)))
    .toISOString()
}
