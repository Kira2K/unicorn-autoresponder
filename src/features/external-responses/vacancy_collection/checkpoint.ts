import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { atomicJson } from '../infrastructure/store.ts'
import { assertAllowedUrl } from '../infrastructure/navigation-policy.ts'
import { CollectionPersistenceError } from './persistence-error.ts'
import type { PageDocument, PageReader } from '../types.ts'
import type { VacancyCollection } from './index.ts'

async function optionalJson(path: string): Promise<any> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (cause: any) { if (cause.code === 'ENOENT') return undefined; throw new CollectionPersistenceError('collection_checkpoint_unreadable', { cause }) }
}
function identityHash(identity: Record<string, unknown>) {
  const scope = identity.scope as Record<string, unknown> | undefined
  // A fresh DB read changes its capture time, not its configured membership/policies.
  if (!scope) return digest(identity)
  const { capturedAt: _time, digest: _digest, ...configuration } = scope
  return digest({ ...identity, scope: configuration })
}

/** Run-local replay, not a refresh policy. Stores public page data only, never browser sessions. */
export async function openCollectionCheckpoint(input: { directory: string; identity: Record<string, unknown>; resume?: boolean }) {
  const hash = identityHash(input.identity), lockPath = join(input.directory, 'checkpoint.lock'), token = randomUUID()
  await mkdir(input.directory, { recursive: true })
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) }
  catch (cause: any) {
    if (cause.code === 'EEXIST') throw new CollectionPersistenceError('collection_checkpoint_locked: verify the recorded PID has exited before removing a stale lock')
    throw new CollectionPersistenceError('collection_checkpoint_lock_failed', { cause })
  }
  const close = async () => { if ((await optionalJson(lockPath))?.token === token) await unlink(lockPath) }
  try {
    try { await lock.writeFile(JSON.stringify({ token, pid: process.pid, at: new Date().toISOString() })); await lock.sync() }
    finally { await lock.close() }
    const manifestPath = join(input.directory, 'manifest.json'), previous = await optionalJson(manifestPath)
    if (previous && !input.resume) throw new CollectionPersistenceError('collection_checkpoint_exists: use --resume or a new run ID')
    if (!previous && input.resume) throw new CollectionPersistenceError('collection_checkpoint_missing')
    if (previous && (previous.version !== 1 || previous.hash !== hash)) throw new CollectionPersistenceError('collection_checkpoint_scope_changed')
    if (!previous) await atomicJson(manifestPath, { version: 1, hash, identity: input.identity })
    const completedPath = join(input.directory, 'completed.json'), saved = await optionalJson(completedPath)
    if (saved && (saved.hash !== hash || saved.checksum !== digest(saved.collection))) throw new CollectionPersistenceError('collection_checkpoint_corrupt')
    let completed: VacancyCollection | undefined = saved?.collection
    const inFlight = new Map<string, Promise<PageDocument>>()
    return {
      completed,
      close,
      reader(reader: PageReader): PageReader {
        return { read: async (url, options) => {
          assertAllowedUrl(url)
          const key=digest(options?.steps || options?.extraction || options?.previous?.httpValidator ? [url, options.steps, options.previous?.httpValidator, ...(options.extraction?[options.extraction]:[])] : url)
          const existing = inFlight.get(key); if (existing) return structuredClone(await existing)
          const task = (async () => {
            const path = join(input.directory, 'pages', key + '.json'), cached = await optionalJson(path)
            if (cached) {
              if (cached.hash !== hash || cached.url !== url || digest(cached.page) !== cached.checksum) throw new CollectionPersistenceError('collection_page_checkpoint_corrupt')
              assertAllowedUrl(cached.page.url)
              return { ...(cached.page as PageDocument), evidenceRef:path, evidenceHash:cached.checksum }
            }
            const fetched = await reader.read(url, options)
            assertAllowedUrl(fetched.url)
            const page = { ...fetched, fetchedAt: fetched.fetchedAt ?? new Date().toISOString() }
            const checksum=digest(page)
            try { await atomicJson(path, { hash, url, checksum, page }) }
            catch (cause) { throw new CollectionPersistenceError('collection_page_checkpoint_save_failed', { cause }) }
            return { ...page,evidenceRef:path,evidenceHash:checksum }
          })()
          inFlight.set(key, task)
          try { return structuredClone(await task) } finally { inFlight.delete(key) }
        } }
      },
      async complete(collection: VacancyCollection) {
        if (completed && digest(completed) !== digest(collection)) throw new CollectionPersistenceError('collection_checkpoint_immutable')
        try { await atomicJson(completedPath, { hash, checksum: digest(collection), collection }) }
        catch (cause) { throw new CollectionPersistenceError('collection_checkpoint_save_failed', { cause }) }
        completed = structuredClone(collection)
      },
    }
  } catch (error) { await close(); throw error }
}
