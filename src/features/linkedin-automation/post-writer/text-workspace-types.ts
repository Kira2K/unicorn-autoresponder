import type { JsonFiles } from './json-files.ts'
import type { createCvFiles } from './cv-files.ts'
import type { Context, WriterCheckpoint, WriterModel } from './writer-types.ts'
import type { Log } from './types.ts'
import type { MemeServices, MemeState } from './meme-types.ts'
export type TextAuthor = { id: string; name: string; role: string; level: string; stack: string[]
  audience: string; style: string; forbiddenTopics: string[]; cvRef?: string; memes?: boolean }
export type TextJob = { id: string; author: string; authorSnapshot: TextAuthor; requestedTopic?: string
  status: 'queued' | 'generating' | 'ready' | 'blocked' | 'cancelled' | 'retrying'
  createdAt: number; context?: Context; checkpoint?: WriterCheckpoint; errorCode?: string
  nextActionAt?: number; policyKey?: string; readyAt?: number; meme?: MemeState }
export type TextWorkspaceDependencies = { files: JsonFiles; cv: ReturnType<typeof createCvFiles>
  model: WriterModel; enabled: boolean; now: () => number; log?: Log; memes?: MemeServices }
export const textActive = (job: TextJob) => ['queued', 'generating', 'retrying'].includes(job.status)
