import { mkdir, open, readFile, rename, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { digest } from './content-identity.ts'
import { createSerialQueue } from './serial.ts'
import { retryLocalFile } from './local-file-retry.ts'
export interface JsonFiles {
  get<T>(bucket: string, key: string): Promise<T | undefined>
  put<T>(bucket: string, key: string, value: T): Promise<void>
  list<T>(bucket: string): Promise<T[]>
}
export function createJsonFiles(directory: string): JsonFiles {
  const root = resolve(directory)
  const serial = createSerialQueue()
  const folder = (bucket: string) => {
    if (!/^[a-z-]+$/.test(bucket)) throw new Error('post_storage_bucket_invalid')
    return join(root, bucket)
  }
  async function read<T>(path: string): Promise<T | undefined> {
    try { return JSON.parse(await retryLocalFile(() => readFile(path, 'utf8'))) as T }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return {
    get: <T>(bucket: string, key: string) => read<T>(join(folder(bucket), `${digest(key)}.json`)),
    put: <T>(bucket: string, key: string, value: T) => serial(`${bucket}:${key}`, async () => {
      const body = JSON.stringify(value)
      const dir = folder(bucket)
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const path = join(dir, `${digest(key)}.json`)
      const temporary = `${path}.${randomUUID()}.tmp`
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(body, 'utf8'); await handle.sync() }
      finally { await handle.close() }
      await retryLocalFile(() => rename(temporary, path))
      if (await retryLocalFile(() => readFile(path, 'utf8')) !== body) throw new Error('post_storage_readback_failed')
    }),
    async list<T>(bucket: string) {
      let names: string[]
      try { names = await readdir(folder(bucket)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
      const values: T[] = []
      for (const name of names.filter(name => /^[a-f0-9]+\.json$/.test(name)).sort()) {
        const value = await read<T>(join(folder(bucket), name))
        if (value !== undefined) values.push(value)
      }
      return values
    }
  }
}
