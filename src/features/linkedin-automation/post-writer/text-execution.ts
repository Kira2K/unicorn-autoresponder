import { writePost } from './writer.ts'
import { contentHash } from './content-identity.ts'
import { rulesKey } from './content-rules.ts'
import { PostError } from './errors.ts'
import type { TextJob, TextWorkspaceDependencies } from './text-workspace-types.ts'
import { textRules } from './text-rules.ts'
import { generateTextMeme } from './text-meme.ts'

export async function executeText(job: TextJob, deps: TextWorkspaceDependencies, signal: AbortSignal) {
  const save = async () => {
    try { await deps.files.put('text-jobs', job.id, job) }
    catch { throw new PostError('post_text_persistence_unavailable') }
    deps.log?.('text_checkpoint', { jobId: job.id, status: job.status, repairs: job.checkpoint?.repairCount ?? 0 })
  }
  job.status = 'generating'
  job.errorCode = undefined
  job.nextActionAt = undefined
  await save()
  const author = job.authorSnapshot
  if (author.memes && !deps.memes?.enabled) throw new PostError('meme_generation_disabled')
  if (!author.cvRef) throw new PostError('post_cv_missing')
  if (!job.context) {
    job.context = { ...await deps.cv.uploadedContext(author.cvRef), role: author.role,
      level: author.level, audience: author.audience, style: author.style }
    if (author.stack.length) job.context.stack = [...author.stack]
    await save()
  }
  if (signal.aborted) { job.status = 'cancelled'; await save(); return }
  const rules = await textRules(job, deps.files)
  job.policyKey = rulesKey(rules)
  const history = (await deps.files.list<TextJob>('text-jobs')).filter(item =>
    item.author === job.author && item.id !== job.id && (item.status === 'ready' || item.readyAt) && item.checkpoint?.draft)
    .sort((a, b) => a.createdAt - b.createdAt).map(item => ({ text: item.checkpoint!.draft!.text,
      hash: contentHash(item.checkpoint!.draft!.text), signature: item.checkpoint!.topic!.signature }))
  const result = await writePost({ context: job.context, history, rules }, deps.model, { signal,
    checkpoint: job.checkpoint, onCheckpoint: async value => { job.checkpoint = value; await save() } })
  job.checkpoint = result.checkpoint
  if (!signal.aborted && result.status === 'ready') {
    if (!await generateTextMeme(job, deps, rules.forbiddenTopics ?? [], signal, save)) { await save(); return }
  }
  job.status = signal.aborted ? 'cancelled' : result.status
  if (job.status === 'ready' && job.policyKey !== rulesKey(await textRules(job, deps.files))) job.status = 'queued'
  if (job.status === 'ready') job.readyAt ??= deps.now()
  await save()
}
