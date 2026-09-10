import type { Context, Topic, Draft } from './writer-types.ts'
export type { Fact, Context, Topic, Draft, WriterModel as Generator } from './writer-types.ts'
import type { WriterModel } from './writer-types.ts'
import type { MemeState, MemeHistory, MemeServices } from './meme-types.ts'
import { defaultWindows, type TimeWindow } from './time-windows.ts'
export type ManualMode = 'approval_required' | 'automatic'
export type PostStatus = 'queued' | 'generating' | 'awaiting_approval' | 'ready' |
  'publishing' | 'verifying' | 'uncertain' | 'published' | 'blocked' | 'stopped' | 'rejected'
export type Slot = { date: string; at: number; state: 'planned' | 'started' | 'missed' | 'cancelled' }
export type Settings = {
  account: number; scheduled: boolean; days: number[]; manualMode: ManualMode; likes: boolean
  slot?: Slot; lastMissedSlot?: Slot; context?: Context
  intervals?: TimeWindow[]; forbiddenTopics?: string[]; memes?: boolean
}
export type Account = { platformAccountId: number; clientName: string; unipileAccountId: string
  verifiedProviderId: string; linkedinUrl?: string }
export type Like = { account: Account; status: 'pending' | 'sending' | 'uncertain' |
  'sent' | 'failed' | 'cancelled'; attemptedAt?: number; confirmedAt?: number }
export type Engagement = { status: 'off' | 'pending' | 'running' | 'partial' | 'completed' |
  'cancelled' | 'uncertain'; target: number; items: Like[] }
export type PostRun = {
  id: string; account: number; trigger: 'scheduled' | 'manual'; mode: ManualMode
  status: PostStatus; createdAt: number; updatedAt: number; executorId: string
  likesEnabled: boolean; target?: Account; context?: Context; topics?: Topic[]; topic?: Topic
  draft?: Draft; hash?: string; approvedHash?: string; repairCount: number; issues: string[]
  stop: boolean; nextActionAt?: number; attemptedAt?: number; postId?: string; url?: string
  publishedAt?: number; errorCode?: string; engagement: Engagement
  requestedTopic?: string; policyKey?: string; reviewedKey?: string; cvRef?: string
  memeEnabled?: boolean; meme?: MemeState; postImageId?: string; memeReviewedHash?: string
}
export type History = { id: string; account: number; runId: string; hash: string; text: string
  signature: string; status: 'sending' | 'published'; postId?: string; url?: string
  meme?: MemeHistory; publishedAt?: number }
export type Tables = { settings: Settings; runs: PostRun; history: History }
export interface PostStore {
  list<K extends keyof Tables>(table: K, account?: number): Promise<Tables[K][]>
  get<K extends keyof Tables>(table: K, key: string): Promise<Tables[K] | undefined>
  put<K extends keyof Tables>(table: K, key: string, value: Tables[K]): Promise<void>
  claim(key: string, value: History): Promise<{ value: History; created: boolean }>
}
export interface PostSource {
  accounts(): Promise<Account[]>
  context(account: number, previous?: Context): Promise<Context>
  uploadCv?(value: unknown): Promise<string>
  uploadedContext?(reference: string, previous?: Context): Promise<Context>
}
export type ProviderImage = { id: string; available: boolean; width?: number; height?: number }
export type PostMedia = { content: string; content_type: 'image/png'; filename: string }
export type ProviderPost = { id: string; text: string; authorId: string; url: string; createdAt: number
  images?: ProviderImage[] }
export interface PostAdapter {
  identity(account: Account): Promise<void>
  publish(account: Account, text: string, image?: PostMedia): Promise<ProviderPost>
  read(account: Account, id: string): Promise<ProviderPost>
  recent(account: Account): Promise<ProviderPost[]>
  reacted(account: Account, id: string): Promise<boolean>
  like(account: Account, id: string): Promise<void>
}
export type Gate = { acquire(kind: string, id: string, account: string): () => void }
export type Log = (event: string, fields?: Record<string, string | number | boolean>) => void
export type Dependencies = { store: PostStore; source: PostSource; generator: WriterModel
  adapter: PostAdapter; gate: Gate; writerId: string; writable: boolean; now: () => number
  random: () => number; log: Log; mock?: boolean; memes?: MemeServices }
export const defaults = (account: number): Settings => ({ account, scheduled: false, days: [],
  manualMode: 'approval_required', likes: false, memes: false, intervals: defaultWindows(), forbiddenTopics: [] })
export const active = (run: PostRun) => !['blocked', 'stopped', 'rejected'].includes(run.status) &&
  (run.status !== 'published' || ['pending', 'running', 'uncertain'].includes(run.engagement.status))
