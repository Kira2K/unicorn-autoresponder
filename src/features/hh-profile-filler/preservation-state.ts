import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { operationStorageRoot } from './operation-state.ts'
import { PROFILE_CONTRACT_VERSION } from './contract.ts'

// Call only with digests or public HH employer names, never raw CV/credentials.
// The first observation is immutable across processes and retries of the operation.
export function preserveFirstObservation<T>(operationId: string, resumeId: string, section: string,
  value: T, root = operationStorageRoot()): T {
  const directory = path.join(root, 'preservation')
  fs.mkdirSync(directory, { recursive: true })
  const key = createHash('sha256').update(JSON.stringify([
    PROFILE_CONTRACT_VERSION, operationId, resumeId, section])).digest('hex')
  const file = path.join(directory, `${key}.json`)
  try { fs.writeFileSync(file, JSON.stringify(value), { flag: 'wx', mode: 0o600 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}
