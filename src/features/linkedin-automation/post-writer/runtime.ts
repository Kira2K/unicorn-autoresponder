import { createPostWriterService, type PostWriterService } from './service.ts'
import { createPostNocoTransport } from './noco-transport.ts'
import { createPostNocoStore } from './noco-store.ts'
import { createPostLogger } from './logger.ts'
import { createPostSource } from './source.ts'
import { createFactsExtractor } from './extract-facts.ts'
import { selectFinalEnglishCv } from '../profile-filler/generation/cv-source.ts'
import { loadDriveCv } from '../profile-filler/generation/drive-cv.ts'
import { createPostOpenAi } from './openai-client.ts'
import { createPostAdapter, type PostHttp } from '../../../integrations/unipile/post-writer-adapter.ts'
import { createUnipileRequestScheduler } from '../../../integrations/unipile/request-scheduler.ts'
import * as httpModule from '../../../integrations/unipile/http-client.ts'
import { acquirePostWriterLease } from './writer-lease.ts'
import { registerWriterShutdown } from './shutdown-signals.ts'
import { PostError, errorCode } from './errors.ts'
import type { Gate } from './types.ts'
import type { LinkedInAuthAccountRow } from '../account-connection/types.ts'
import { createJsonFiles } from './json-files.ts'
import { createCvFiles } from './cv-files.ts'
import { createMemeServices } from './meme-runtime.ts'
import { resolve } from 'node:path'
import * as schemaModule from '../../../integrations/noco/core/schema.ts'
import { commonJsExports } from './commonjs-exports.ts'
const { TABLES } = commonJsExports<{
  TABLES: { cvProcessing: { id: string } }
}>(schemaModule)
const { createUnipileHttpClient } = commonJsExports<{ createUnipileHttpClient(): PostHttp }>(httpModule)

export function createLivePostWriter(repository: { listAccounts(): Promise<LinkedInAuthAccountRow[]> },
  gate: Gate, control: { env?: NodeJS.ProcessEnv } = {}): PostWriterService {
  const env = control.env ?? process.env
  const log = createPostLogger()
  let service: Promise<PostWriterService> | undefined
  let release: (() => void) | undefined
  let closed: Promise<void> | undefined
  let closing = false
  let removeSignals: (() => void) | undefined
  const initialize = () => closing ? Promise.reject(new PostError('post_writer_closing')) : service ??= (async () => {
    const writable = env.LINKEDIN_POST_WRITER_ENABLED === 'true'
    const writerId = env.LINKEDIN_POST_WRITER_ID ?? ''
    if (writable) {
      release = await acquirePostWriterLease(writerId)
      removeSignals = registerWriterShutdown(close, log)
    }
    const http = createPostNocoTransport(log)
    const model = createPostOpenAi(log, env)
    let unipileClient: PostHttp | undefined
    // Preserve lazy configuration: read-only work must not require a publishing client.
    const unipile: PostHttp = {
      request<T>(...args: Parameters<PostHttp['request']>) {
        unipileClient ??= createUnipileHttpClient()
        return unipileClient.request<T>(...args)
      }
    }
    const scheduler = createUnipileRequestScheduler()
    const files = createJsonFiles(resolve(env.LINKEDIN_POST_DATA_DIR || 'storage/post-writer'))
    const uploads = createCvFiles(files, createFactsExtractor(model.respond))
    return createPostWriterService({ store: createPostNocoStore(http),
      source: { ...uploads, ...createPostSource({ accounts: () => repository.listAccounts(),
        cvRows: () => http.records(TABLES.cvProcessing.id), selectCv: selectFinalEnglishCv,
        loadCv: loadDriveCv, extractFacts: createFactsExtractor(model.respond) }) },
      generator: model, memes: createMemeServices(files, model.respond, log, env),
      adapter: createPostAdapter(log, unipile, scheduler), gate, writable,
      writerId, now: Date.now, random: Math.random, log })
  })().catch(error => { removeSignals?.(); release?.(); service = undefined; throw error })
  function close() {
    closing = true
    return closed ??= (async () => {
      await (await service)?.close()
      removeSignals?.()
      release?.()
    })()
  }
  if (env.LINKEDIN_POST_WRITER_ENABLED === 'true') {
    void initialize().catch(error => log('startup_blocked', { code: errorCode(error) }))
  }
  return {
    get: async account => (await initialize()).get(account),
    image: async id => (await initialize()).image(id),
    update: async (account, input) => (await initialize()).update(account, input),
    start: async (account, mode, key, input) => (await initialize()).start(account, mode, key, input),
    action: async (id, action, hash, reviewed) => (await initialize()).action(id, action, hash, reviewed),
    tick: async () => (await initialize()).tick(),
    subscribe(account, listener) {
      let removed = false
      let unsubscribe: (() => void) | undefined
      void initialize().then(value => { if (!removed) unsubscribe = value.subscribe(account, listener) })
        .catch(error => log('subscription_error', { code: errorCode(error) }))
      return () => { removed = true; unsubscribe?.() }
    },
    close
  }
}
