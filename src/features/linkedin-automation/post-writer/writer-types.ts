export type Fact = { id: string; text: string; evidence: string }
import type { ContentRules } from './content-rules.ts'
export type Context = { revision: string; role: string; stack: string[]; facts: Fact[]
  level?: string; audience?: string; style?: string; factsVersion?: string }
export type Topic = { title: string; signature: string; factIds: string[]; score: number }
export type Draft = { text: string; factIds: string[]; claims: { text: string; factId: string }[] }
export type ContentHistory = { hash: string; text: string; signature: string }
export type WriterInput = { context: Context; history: ContentHistory[]; rules?: ContentRules }

// Implementations return untrusted model output; the Writer owns validation.
// They must not retain or modify the supplied context between calls.
export interface WriterModel {
  topics(context: Context, history: ContentHistory[], rules?: ContentRules): Promise<unknown>
  draft(context: Context, topic: Topic, previous?: Draft, issues?: string[], rules?: ContentRules): Promise<unknown>
  review?(context: Context, input: { topic: Topic; text?: string; rules: ContentRules }): Promise<unknown>
}
export type WriterCheckpoint = {
  topics?: Topic[]; topic?: Topic; draft?: Draft; issues: string[]; repairCount: number
  reviewedKey?: string
}
export type WriterOptions = {
  signal?: AbortSignal
  checkpoint?: WriterCheckpoint
  // Awaited before another model request. Persistence errors propagate unchanged.
  // On a failed repair reservation, called again with its rollback. Retain the latest
  // checkpoint for retry even when persistence fails; older queued saves must not win.
  onCheckpoint?: (checkpoint: WriterCheckpoint) => Promise<void>
}
export type WriterResult =
  | { status: 'ready'; checkpoint: WriterCheckpoint & { topic: Topic; draft: Draft } }
  | { status: 'blocked'; checkpoint: WriterCheckpoint }
  | { status: 'cancelled'; checkpoint: WriterCheckpoint }
