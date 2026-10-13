import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { PreparedProfile } from './types.ts'
import type { ResumeSnapshot } from './hh-resume-ui.ts'
import { PROFILE_CONTRACT_VERSION } from './contract.ts'

export function operationId(profile: Pick<PreparedProfile, 'client'>, jobId?: string): string {
  if (jobId) return jobId
  return createHash('sha256').update(JSON.stringify([PROFILE_CONTRACT_VERSION, jobId ?? 'manual',
    profile.client.clientId, profile.client.market, profile.client.dolphinProfileId,
    profile.client.cvRevision, profile.client.sourceIdentity?.host,
    profile.client.sourceIdentity?.database])).digest('hex')
}

export function operationStorageRoot(): string {
  return process.env.PROFILE_FILLER_STORAGE_ROOT || path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '../../../storage/hh-profile-filler')
}

export type OperationState = {
  version: number
  operationId: string
  oldResumes: ResumeSnapshot[]
  targets: Record<string, ResumeSnapshot>
  nativeDuplicateIds: string[]
  deletedIds: string[]
}

export function openOperation(id: string, initial: ResumeSnapshot[], root = operationStorageRoot()) {
  const directory = path.join(root, 'operations')
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${createHash('sha256').update(id).digest('hex')}.json`)
  const state: OperationState = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
    version: PROFILE_CONTRACT_VERSION, operationId: id, oldResumes: initial,
    targets: {}, nativeDuplicateIds: [], deletedIds: []
  }
  if (state.version !== PROFILE_CONTRACT_VERSION || state.operationId !== id) throw new Error('profile_operation_state_invalid')
  const save = () => {
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, file)
  }
  save()
  return { state, save }
}
