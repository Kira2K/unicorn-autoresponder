import { writeMeme } from './meme.ts'
import { PostError } from './errors.ts'
import type { TextJob, TextWorkspaceDependencies } from './text-workspace-types.ts'
export async function generateTextMeme(job: TextJob, deps: TextWorkspaceDependencies,
  forbiddenTopics: string[], signal: AbortSignal, save: () => Promise<void>) {
  if (!job.authorSnapshot.memes) return true
  if (!deps.memes?.enabled || !job.checkpoint?.draft || !job.context) throw new PostError('meme_generation_disabled')
  const history = (await deps.files.list<TextJob>('text-jobs')).filter(item => item.id !== job.id &&
    item.author === job.author && item.meme?.status === 'ready' && item.meme.concept)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 10).map(item => item.meme!.concept!)
  job.meme = await writeMeme({ post: job.checkpoint.draft.text, audience: job.context.audience ?? '',
    forbiddenTopics, history }, deps.memes, { id: `text-${job.id}`, signal, checkpoint: job.meme,
    onCheckpoint: async meme => {
      job.meme = meme
      await save()
      deps.log?.('meme_checkpoint', { jobId: job.id, status: meme.status,
        plannerCalls: meme.plannerCalls, imageCalls: meme.imageCalls })
    } })
  if (job.meme.status !== 'ready') {
    job.status = signal.aborted ? 'cancelled' : 'blocked'
    job.errorCode = job.meme.errorCode ?? 'meme_not_ready'
    return false
  }
  return true
}
