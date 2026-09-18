import type { ProfileJob } from '../../linkedin-automation/profile-filler/job-types.ts'
import type { MonitorJob } from '../../linkedin-automation/comment-monitor/types.ts'
import type { ConnectionInviterStore } from '../../linkedin-automation/connection-inviter/types.ts'
import type { PostWriterStorage } from '../../linkedin-automation/post-writer/runtime.ts'
import type { AuthRepository, AuthHistory } from './postgres/linkedin-contracts.mts'
import type { LinkedInAuthAccountRow } from '../../linkedin-automation/account-connection/types.ts'

// Complete storage bundle: never mix an explicitly selected SQL store with a Noco default.
export interface LinkedInStorageOptions {
  repository: AuthRepository
  history: AuthHistory
  profile: {
    create(job: ProfileJob): Promise<void>
    get(id: string): Promise<ProfileJob | undefined>
    list(account?: number): Promise<ProfileJob[]>
    listActive(account: number): Promise<ProfileJob[]>
    listPendingVerification(): Promise<ProfileJob[]>
    update(id: string, patch: Partial<ProfileJob>): Promise<void>
  }
  generation: { getGenerationContext(id: number, account?: LinkedInAuthAccountRow):
    Promise<{ account: LinkedInAuthAccountRow; cvUrl: string; cvRevision: string }> }
  comments: {
    create(job: MonitorJob): Promise<void>
    get(id: string): Promise<MonitorJob | undefined>
    list(): Promise<MonitorJob[]>
    update(job: MonitorJob): Promise<void>
    purge(before: string): Promise<void>
  }
  inviter: ConnectionInviterStore
  posts: PostWriterStorage
}
