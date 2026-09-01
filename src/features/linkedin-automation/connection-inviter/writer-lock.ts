import { randomUUID } from 'node:crypto'
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectionError } from './errors.ts'

type LockMetadata = { nonce: string; pid: number; writerId?: string; createdAt: string }

export type ConnectionWriterLock = {
  assertOwned(): void
  release(): void
}

const ownedLocks = new Map<string, { nonce: string }>()
let exitCleanupRegistered = false

export function connectionWriterLockPath(_writerId?: string) {
  // The lock is machine-global. writerId identifies the durable executor in Noco and
  // audit logs; it must not create a second local writer namespace.
  return join(tmpdir(), 'unicorn-linkedin-connection-writer.lock')
}

function readLock(path: string): { raw: string; metadata?: LockMetadata } | undefined {
  try {
    const raw = readFileSync(path, 'utf8')
    const value = JSON.parse(raw)
    if (typeof value?.nonce === 'string' && Number.isInteger(value?.pid)) {
      return { raw, metadata: value as LockMetadata }
    }
    return { raw }
  } catch (error: any) {
    if (error?.code === 'ENOENT') return undefined
    return { raw: '' }
  }
}

function processIsAlive(pid: number) {
  if (pid === process.pid) return true
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (error: any) { return error?.code === 'EPERM' }
}

function removeStaleLock(path: string, observed: { raw: string; metadata?: LockMetadata }) {
  // An empty/partial file may be between atomic create and metadata write. It is not proof
  // of staleness and must fail closed.
  if (!observed.metadata || processIsAlive(observed.metadata.pid)) return false
  try {
    if (readFileSync(path, 'utf8') !== observed.raw) return false
    unlinkSync(path)
    return true
  } catch { return false }
}

function releaseOwned(path: string, nonce: string) {
  if (ownedLocks.get(path)?.nonce !== nonce) return
  ownedLocks.delete(path)
  const current = readLock(path)
  if (current?.metadata?.nonce !== nonce || current.metadata.pid !== process.pid) return
  try { unlinkSync(path) } catch { /* A replaced lock belongs to another writer. */ }
}

function registerExitCleanup() {
  if (exitCleanupRegistered) return
  exitCleanupRegistered = true
  process.once('exit', () => {
    for (const [path, owner] of [...ownedLocks]) releaseOwned(path, owner.nonce)
  })
}

export function acquireConnectionWriterLock(writerId: string): ConnectionWriterLock {
  const path = connectionWriterLockPath(writerId)
  if (ownedLocks.has(path)) {
    throw connectionError('connection_writer_lock_active',
      'Another Connection Inviter writer is active in this process.')
  }
  const nonce = randomUUID()
  const metadata: LockMetadata = { nonce, pid: process.pid, writerId,
    createdAt: new Date().toISOString() }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let descriptor: number | undefined
    try {
      descriptor = openSync(path, 'wx', 0o600)
      writeFileSync(descriptor, JSON.stringify(metadata), 'utf8')
      closeSync(descriptor); descriptor = undefined
      ownedLocks.set(path, { nonce }); registerExitCleanup()
      return {
        assertOwned() {
          const current = readLock(path)
          if (ownedLocks.get(path)?.nonce !== nonce ||
            current?.metadata?.nonce !== nonce || current.metadata.pid !== process.pid ||
            current.metadata.writerId !== writerId) {
            throw connectionError('connection_writer_fence_lost',
              'Connection Inviter writer ownership was lost.')
          }
        },
        release() { releaseOwned(path, nonce) }
      }
    } catch (error: any) {
      if (descriptor !== undefined) try { closeSync(descriptor) } catch { /* noop */ }
      if (error?.code !== 'EEXIST') throw error
      const existing = readLock(path)
      if (!existing || !removeStaleLock(path, existing)) {
        throw connectionError('connection_writer_lock_active',
          'Another Connection Inviter writer process is active.')
      }
    }
  }
  throw connectionError('connection_writer_lock_active',
    'Connection Inviter writer lock could not be acquired.')
}
