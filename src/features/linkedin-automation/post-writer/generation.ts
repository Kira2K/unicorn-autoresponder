import { writePost } from './writer.ts'
import { prepareGeneration } from './prepare-generation.ts'
import { runContentHash } from './run-content.ts'
import { generateRunMeme } from './run-meme.ts'
import { PostError } from './errors.ts'
import type { GenerationExecution } from './execution-types.ts'
import type { PostRun } from './types.ts'

export async function generate(run: PostRun, e: GenerationExecution) {
  const controller = new AbortController()
  e.generationControllers.set(run.id, controller)
  try {
    if (run.memeEnabled && !e.memes?.enabled) throw new PostError('meme_generation_disabled')
    const input = await prepareGeneration(run, e)
    if (!input || run.stop || controller.signal.aborted) return
    const result = await writePost(input, e.generator, {
      signal: controller.signal,
      checkpoint: { topics: run.topics, topic: run.topic, draft: run.draft,
        issues: run.issues, repairCount: run.repairCount, reviewedKey: run.reviewedKey },
      onCheckpoint: async checkpoint => {
        Object.assign(run, checkpoint)
        await e.save(run)
      }
    })
    if (result.status === 'cancelled' || run.stop) return
    Object.assign(run, result.checkpoint)
    if (result.status === 'blocked') {
      run.status = 'blocked'
      if (!run.topic || run.issues[0] === 'invalid_shape') run.errorCode = run.issues[0]
    } else {
      if (!await generateRunMeme(run, e, controller.signal) || run.stop) return
      run.hash = runContentHash(run)
      run.approvedHash = undefined
      run.memeReviewedHash = undefined
      run.status = run.mode === 'approval_required' ? 'awaiting_approval' : 'ready'
    }
    await e.save(run)
  } finally {
    e.generationControllers.delete(run.id)
  }
}
