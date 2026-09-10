import { resolve } from 'node:path'
import { createJsonFiles } from './json-files.ts'
import { createCvFiles } from './cv-files.ts'
import { createTextWorkspace, type TextWorkspace } from './text-workspace.ts'
import { createFactsExtractor } from './extract-facts.ts'
import { createPostOpenAi } from './openai-client.ts'
import { createPostLogger } from './logger.ts'
import { createMockDependencies } from './mock.ts'
import { mockContext } from './mock-content.ts'
import { memoryJsonFiles } from './memory-json-files.ts'
import { acquirePostWriterLease } from './writer-lease.ts'
import { registerWriterShutdown } from './shutdown-signals.ts'
import { PostError } from './errors.ts'
import { createMemeServices } from './meme-runtime.ts'
import { createMockMemes } from './meme-mock.ts'
export { memoryJsonFiles } from './memory-json-files.ts'

export function createTextRuntime(mock = false, env = process.env): TextWorkspace {
  const files = mock ? memoryJsonFiles() : createJsonFiles(resolve(env.LINKEDIN_POST_DATA_DIR || 'storage/post-writer'))
  const live = createPostOpenAi(createPostLogger(), env)
  const model = mock ? createMockDependencies({ acquire: () => () => {} }).generator : live
  const cv = createCvFiles(files, mock ? async () => structuredClone(mockContext) : createFactsExtractor(live.respond))
  const enabled = mock || env.LINKEDIN_POST_TEXT_ENABLED === 'true'
  let release: (() => void) | undefined, removeSignals: (() => void) | undefined
  let service: Promise<TextWorkspace> | undefined, closing: Promise<void> | undefined
  const get = () => {
    if (closing) return Promise.reject(new PostError('post_writer_closing'))
    return service ??= (async () => {
      if (!mock && enabled) {
        release = await acquirePostWriterLease('post-text-workspace', 4440)
        removeSignals = registerWriterShutdown(close, createPostLogger())
      }
      return createTextWorkspace({ files, cv, model, now: Date.now, enabled,
        log: mock ? undefined : createPostLogger(),
        memes: mock ? createMockMemes() : createMemeServices(files, live.respond, createPostLogger(), env) })
    })().catch(error => { release?.(); service = undefined; throw error })
  }
  const close = () => closing ??= (async () => {
    try { await (await service)?.close() } finally { removeSignals?.(); release?.() }
  })()
  return {
    snapshot: async () => (await get()).snapshot(),
    image: async id => (await get()).image(id),
    saveAuthor: async (...args) => (await get()).saveAuthor(...args),
    savePolicy: async value => (await get()).savePolicy(value),
    start: async (...args) => (await get()).start(...args),
    stop: async id => (await get()).stop(id), tick: async () => (await get()).tick(), close
  }
}
