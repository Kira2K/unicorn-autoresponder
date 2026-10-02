import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { profileFillerError } from './errors.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../storage/hh-profile-filler/locks')

export function acquireProfileLock(id: number, directory = root): () => void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('profile_lock_invalid_id')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${id}.json`)
  const token = randomUUID()
  try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // A stale lock needs explicit inspection: never steal from a possibly running Dolphin session.
    throw profileFillerError('profile_already_running',
      'This Dolphin profile is locked by another or an interrupted operation.', 'start_dolphin')
  }
  return () => {
    if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file)
  }
}
