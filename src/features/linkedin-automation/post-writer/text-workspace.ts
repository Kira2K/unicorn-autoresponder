import { createSerialQueue } from './serial.ts'
import { createWorkTracker } from './work-tracker.ts'
import { authorId, parseAuthor } from './text-author.ts'
import { customTopic, topicList } from './content-rules.ts'
import { digest } from './content-identity.ts'
import { PostError, errorCode, retryDelay } from './errors.ts'
import { executeText } from './text-execution.ts'
import { textActive, type TextJob, type TextAuthor, type TextWorkspaceDependencies } from './text-workspace-types.ts'
import { invalidateTextRules } from './text-rules.ts'
import { pendingTextSaves } from './pending-text-saves.ts'
import { runImage } from './run-content.ts'

export function createTextWorkspace(deps: TextWorkspaceDependencies, autoStart = true) {
  const serial = createSerialQueue(), work = createWorkTracker()
  const busy = new Map<string, { controller: AbortController; job: TextJob }>()
  const persistence = pendingTextSaves(deps)
  const writable = () => { if (!deps.enabled || work.isClosing()) throw new PostError('post_text_read_only') }
  const jobs = () => deps.files.list<TextJob>('text-jobs')
  async function tick() {
    if (!deps.enabled || work.isClosing() || !await persistence.flush()) return
    await invalidateTextRules(deps.files)
    for (const job of await jobs()) {
      if (!textActive(job) || busy.has(job.id) || (job.nextActionAt ?? 0) > deps.now()) continue
      if ([...busy.values()].some(item => item.job.author === job.author)) continue
      const controller = new AbortController()
      busy.set(job.id, { job, controller })
      void work.run(async () => {
        try { await executeText(job, deps, controller.signal) }
        catch (error) {
          job.errorCode = errorCode(error)
          deps.log?.('text_error', { jobId: job.id, code: job.errorCode })
          const delay = job.errorCode === 'post_text_persistence_unavailable' ? 30_000 : retryDelay(error)
          job.status = controller.signal.aborted ? 'cancelled' : delay ? 'retrying' : 'blocked'
          job.nextActionAt = delay ? deps.now() + delay : undefined
          await persistence.save(job)
        }
      }).catch(() => undefined).finally(() => busy.delete(job.id))
    }
  }
  const timer = autoStart ? setInterval(() => void work.run(tick).catch(() => undefined), 1000) : undefined
  timer?.unref()
  return {
    tick,
    async snapshot() { return { authors: await deps.files.list<TextAuthor>('authors'),
      jobs: (await jobs()).sort((a, b) => b.createdAt - a.createdAt),
      forbiddenTopics: await deps.files.get<string[]>('policy', 'global') ?? [], writable: deps.enabled,
      memesAvailable: deps.memes?.enabled === true } },
    async image(id: string) {
      const job = await deps.files.get<TextJob>('text-jobs', id)
      if (!job) throw new PostError('post_run_not_found')
      const image = await runImage({ memeEnabled: job.authorSnapshot.memes, meme: job.meme }, deps.memes?.assets)
      if (!image) throw new PostError('post_run_not_found')
      return image
    },
    saveAuthor(id: string, input: unknown, cv?: unknown) { return work.run(() => serial(authorId(id), async () => {
      writable()
      const author = parseAuthor(id, input, await deps.files.get<TextAuthor>('authors', id))
      if (author.memes && !deps.memes?.enabled) throw new PostError('meme_generation_disabled')
      if (cv !== undefined) author.cvRef = await deps.cv.uploadCv(cv)
      await deps.files.put('authors', id, author)
      await invalidateTextRules(deps.files, id)
      return author
    })) },
    savePolicy(value: unknown) { return work.run(async () => {
      writable(); await deps.files.put('policy', 'global', topicList(value))
      await invalidateTextRules(deps.files)
    }) },
    start(id: string, key: string, topic?: unknown) { return work.run(() => serial(authorId(id), async () => {
      writable()
      if (!/^[a-z0-9_-]{8,100}$/i.test(key)) throw new PostError('post_start_invalid')
      const jobId = digest(`${id}:${key}`)
      const existing = (await jobs()).find(job => job.id === jobId || (job.author === id && textActive(job)))
      if (existing) return existing
      const author = await deps.files.get<TextAuthor>('authors', id)
      if (!author?.cvRef) throw new PostError('post_cv_missing')
      if (author.memes && !deps.memes?.enabled) throw new PostError('meme_generation_disabled')
      const job: TextJob = { id: jobId, author: id, authorSnapshot: author, requestedTopic: customTopic(topic),
        status: 'queued', createdAt: deps.now() }
      await deps.files.put('text-jobs', jobId, job)
      return job
    })) },
    stop(id: string) { return work.run(async () => {
      writable()
      const running = busy.get(id)
      if (running) { running.controller.abort(); return }
      const job = persistence.get(id) ?? await deps.files.get<TextJob>('text-jobs', id)
      if (!job) throw new PostError('post_run_not_found')
      if (textActive(job)) {
        job.status = 'cancelled'
        if (!await persistence.save(job)) throw new PostError('post_text_persistence_unavailable')
      }
    }) },
    async close() {
      if (timer) clearInterval(timer)
      const drained = work.drain()
      for (const { controller } of busy.values()) controller.abort()
      await drained
    }
  }
}
export type TextWorkspace = ReturnType<typeof createTextWorkspace>
