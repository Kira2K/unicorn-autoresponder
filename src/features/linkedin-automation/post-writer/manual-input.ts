import { customTopic } from './content-rules.ts'
import { PostError } from './errors.ts'
import type { PostRun, PostSource } from './types.ts'
export type ManualInput = { topic?: unknown; cv?: unknown }
export async function prepareManualInput(run: PostRun, source: PostSource, input?: ManualInput) {
  run.requestedTopic = customTopic(input?.topic)
  if (input?.cv !== undefined) {
    if (!source.uploadCv) throw new PostError('post_upload_unavailable')
    run.cvRef = await source.uploadCv(input.cv)
  }
}
