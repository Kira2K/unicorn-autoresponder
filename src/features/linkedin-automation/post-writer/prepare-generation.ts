import { PostError } from './errors.ts'
import type { PostRun } from './types.ts'
import type { GenerationExecution } from './execution-types.ts'
import type { WriterInput } from './writer-types.ts'
import { runRules } from './run-policy.ts'
import { rulesKey } from './content-rules.ts'
import { contentHash } from './content-identity.ts'

type Preparation = Pick<GenerationExecution, 'source' | 'store' | 'settings' | 'saveContext' | 'save'>

export async function prepareGeneration(run: PostRun, e: Preparation): Promise<WriterInput | undefined> {
  run.status = 'generating'
  await e.save(run)
  if (!run.target) {
    run.target = (await e.source.accounts()).find(row => row.platformAccountId === run.account)
    if (!run.target) throw new PostError('post_account_not_ready')
  }
  if (run.stop) return
  if (!run.context) {
    if (run.cvRef && !e.source.uploadedContext) throw new PostError('post_upload_unavailable')
    run.context = run.cvRef ? await e.source.uploadedContext!(run.cvRef, e.settings(run.account).context) :
      await e.source.context(run.account, e.settings(run.account).context)
    if (!run.context.facts.length) throw new PostError('post_facts_missing')
    if (!run.cvRef) await e.saveContext(run.account, run.context)
    await e.save(run)
  }
  if (run.stop) return
  const history = await e.store.list('history', run.account)
  const rules = runRules(run, e)
  run.policyKey = rulesKey(rules)
  return { context: run.context, rules, history: history.map(({ text, signature }) => ({ text, hash: contentHash(text), signature })) }
}
