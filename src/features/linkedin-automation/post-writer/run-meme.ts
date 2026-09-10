import { writeMeme } from './meme.ts'
import { PostError } from './errors.ts'
import { runRules } from './run-policy.ts'
import type { GenerationExecution } from './execution-types.ts'
import type { PostRun } from './types.ts'
export async function generateRunMeme(run: PostRun, e: GenerationExecution, signal: AbortSignal) {
  if (!run.memeEnabled) return true
  if (!e.memes?.enabled || !run.draft || !run.context) throw new PostError('meme_generation_disabled')
  const history = (await e.store.list('history', run.account)).filter(item => item.meme && item.status === 'published')
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).slice(0, 10).map(item => item.meme!)
  run.meme = await writeMeme({ post: run.draft.text, audience: run.context.audience ?? '',
    forbiddenTopics: runRules(run, e).forbiddenTopics ?? [], history }, e.memes, { id: run.id, signal,
    checkpoint: run.meme, onCheckpoint: async value => {
      run.meme = value
      await e.save(run)
      e.log('meme_checkpoint', { runId: run.id, status: value.status,
        plannerCalls: value.plannerCalls, imageCalls: value.imageCalls })
    } })
  if (run.meme.status === 'ready') return true
  run.status = signal.aborted || run.stop ? 'stopped' : 'blocked'
  run.errorCode = run.meme.errorCode ?? 'meme_not_ready'
  await e.save(run)
  return false
}
