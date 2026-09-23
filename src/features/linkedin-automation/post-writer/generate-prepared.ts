import { PostError } from './errors.ts'
import { digest } from './content-identity.ts'
import { reviewRules, rulesKey } from './content-rules.ts'
import { runRules } from './run-policy.ts'
import { generateRunMeme } from './run-meme.ts'
import { runContentHash } from './run-content.ts'
import { validatePreparedPosts } from './prepared-posts.ts'
import type { GenerationExecution } from './execution-types.ts'
import type { PostRun } from './types.ts'

export async function generatePrepared(run: PostRun, e: GenerationExecution, signal: AbortSignal) {
  const [post] = validatePreparedPosts([run.preparedPost])
  run.status = 'generating'
  run.memeEnabled = true
  await e.save(run)
  if (!e.memes?.enabled) throw new PostError('meme_generation_disabled')
  run.target ??= (await e.source.accounts()).find(account => account.platformAccountId === run.account)
  if (!run.target) throw new PostError('post_account_not_ready')
  if (signal.aborted || run.stop) return
  const textKey = digest(post.text)
  run.context = { revision: `prepared-${textKey}`, role: run.target.clientName, stack: [], facts: [],
    audience: 'LinkedIn professional audience' }
  run.topic = { title: post.text.slice(0, 120), signature: `prepared-${textKey}`, factIds: [], score: 1 }
  run.draft = { text: post.text, factIds: [], claims: [] }
  const rules = runRules(run, e)
  run.policyKey = rulesKey(rules)
  const reviewedKey = digest(JSON.stringify([textKey, run.policyKey]))
  await e.save(run)
  if (run.reviewedKey !== reviewedKey) {
    run.issues = await reviewRules(e.generator, run.context, run.topic, rules, post.text)
    if (signal.aborted || run.stop) return
    if (run.issues.length) {
      run.status = 'blocked'
      run.errorCode = run.issues[0]
      await e.save(run)
      return
    }
    run.reviewedKey = reviewedKey
    await e.save(run)
  }
  if (!await generateRunMeme(run, e, signal) || signal.aborted || run.stop) return
  run.hash = runContentHash(run)
  run.approvedHash = undefined
  run.memeReviewedHash = undefined
  run.status = run.mode === 'approval_required' ? 'awaiting_approval' : 'ready'
  await e.save(run)
}
