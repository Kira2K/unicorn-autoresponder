import { readdir, lstat, unlink } from 'node:fs/promises'
import path from 'node:path'

// Only diagnostic JSONL files are disposable. Never inspect stores or journals here.
export async function purgeDetailedLogs(directory: string, now = Date.now()) {
  const files = await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  for (const name of files) if (name.endsWith('.jsonl')) {
    const file = path.join(directory, name), stat = await lstat(file)
    if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < now - 30 * 86_400_000) await unlink(file)
  }
}

const scheduled = new Map<string, string>()
export function maintainDetailedLogs(directory: string, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10)
  if (scheduled.get(directory) === day) return
  scheduled.set(directory, day)
  void purgeDetailedLogs(directory, now).catch(() => scheduled.delete(directory))
}
