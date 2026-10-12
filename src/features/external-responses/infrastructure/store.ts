import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Candidate, BatchState, Store, Event } from '../types.ts'

export function safeId(id: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id)) throw Error('Invalid identifier')
  return id
}
export async function atomicJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  const file = await open(temp, 'wx', 0o600)
  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync() }
  finally { await file.close() }
  try {
    // Windows antivirus/readers can briefly hold the destination. Never delete the
    // durable target or retry the operation which produced this checkpoint.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, path); break }
      catch (error: any) {
        if (attempt >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)))
      }
    }
  } catch (error) { await unlink(temp).catch(() => {}); throw error }
}
async function optionalJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch (error: any) { if (error.code === 'ENOENT') return undefined; throw error }
}
export function redact(value: unknown): any {
  if (typeof value === 'string') return value
    .replace(/https?:\/\/[^\s<>"']+/gi, raw => {
      try {
        const url=new URL(raw)
        if([...url.searchParams.keys()].some(key=>/token|samlrequest|samlresponse|session|state|nonce|code|signature|secret|password|(?:^|_)tk(?:$|_)/i.test(key))){url.search='';url.hash='';return url.href+'?[redacted]'}
      }catch{}
      return raw
    })
    .replace(/(bearer\s+)\S+/gi, '$1[redacted]')
    .replace(/((?:captcha[-_]?token|access[-_]?token|refresh[-_]?token|api[-_]?key|authorization|password|cookie|verification[-_]?code)["']?\s*[=:]\s*["']?)[^"'\s,;}]+/gi, '$1[redacted]')
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, /token|password|cookie|authorization|api.?key|verification.?code/i.test(k) ? '[redacted]' : redact(v)]))
  return value
}
export function createFileStore(storageRoot = 'storage/external-responses', logRoot = 'logs/external-responses'): Store {
  const base = resolve(storageRoot), logs = resolve(logRoot)
  const candidateDir = (id: string) => join(base, 'candidates', safeId(id))
  const batchPath = (candidate: string, batch: string) => join(candidateDir(candidate), 'batches', `${safeId(batch)}.json`)
  return {
    candidate: async id => { const value = await optionalJson<Candidate>(join(candidateDir(id), 'candidate.json')); if (!value) throw Error(`Candidate not found: ${id}`); return value },
    saveCandidate: value => atomicJson(join(candidateDir(value.id), 'candidate.json'), value),
    batch: (candidate, batch) => optionalJson<BatchState>(batchPath(candidate, batch)),
    saveBatch: batch => atomicJson(batchPath(batch.candidateId, batch.id), batch),
    batches: async id => {
      const path = join(candidateDir(id), 'batches')
      const files = await readdir(path).catch((e: any) => { if (e.code === 'ENOENT') return []; throw e })
      return Promise.all(files.filter(f => f.endsWith('.json')).map(async f => (await optionalJson<BatchState>(join(path, f)))!))
    },
    lock: async id => {
      const path = join(candidateDir(id), 'application.lock'); await mkdir(dirname(path), { recursive: true })
      const token = randomUUID()
      let file
      try { file = await open(path, 'wx', 0o600) }
      catch (e: any) { if (e.code === 'EEXIST') throw Error(`Candidate lock exists: ${path}. Verify its PID has exited before removing a stale lock.`); throw e }
      await file.writeFile(JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() })); await file.sync(); await file.close()
      return async () => { const owner = await optionalJson<{ token: string }>(path); if (owner?.token === token) await unlink(path) }
    },
    event: async (event: Event) => {
      const path = join(logs, safeId(event.candidateId), 'events.jsonl'); await mkdir(dirname(path), { recursive: true })
      const file = await open(path, 'a', 0o600)
      try { await file.writeFile(JSON.stringify(redact(event)) + '\n') } finally { await file.close() }
    }
  }
}
export async function diagnostic(store: Store, event: Event) {
  try { await store.event(event) } catch { process.stderr.write('external-responses: diagnostic write failed; durable application state is authoritative.\n') }
}
