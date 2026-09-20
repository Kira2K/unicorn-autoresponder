import { mkdir, readFile, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { State, Store } from './contracts.ts'
export function createWithdrawalFileStore(directory: string): Store {
  function path(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid account ID')
    return join(directory, `${id}.json`)
  }
  return {
    async load(id) {
      let raw: string
      try { raw = await readFile(path(id), 'utf8') }
      catch (error: any) { if (error?.code === 'ENOENT') return undefined; throw error }
      const state = JSON.parse(raw) as State
      if (!state || typeof state.accountId !== 'string' || !Array.isArray(state.attempted) ||
        state.attempted.some(id => typeof id !== 'string') ||
        (state.run && (state.run.platformAccountId !== id || state.run.accountId !== state.accountId ||
          typeof state.run.id !== 'string' || !['running', 'completed', 'stopped', 'failed', 'uncertain', 'interrupted'].includes(state.run.status))))
        throw new Error('Invalid withdrawal journal')
      return state
    },
    async save(id, state) {
      const target = path(id), temporary = `${target}.${randomUUID()}.tmp`
      await mkdir(directory, { recursive: true, mode: 0o700 })
      try {
        const file = await open(temporary, 'wx', 0o600)
        try { await file.writeFile(JSON.stringify(state)); await file.sync() } finally { await file.close() }
        await rename(temporary, target)
      } finally { await rm(temporary, { force: true }) }
    }
  }
}
