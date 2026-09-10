import { rulesKey, topicList, type ContentRules } from './content-rules.ts'
import type { PostRun, Settings } from './types.ts'
type PolicySettings = { settings(account: number): Settings }
export function runRules(run: PostRun, e: PolicySettings): ContentRules {
  return { requestedTopic: run.requestedTopic, forbiddenTopics: topicList([
    ...new Set([...(e.settings(0).forbiddenTopics ?? []), ...(e.settings(run.account).forbiddenTopics ?? [])])
  ], 100) }
}
export const policyCurrent = (run: PostRun, e: PolicySettings) =>
  run.policyKey === rulesKey(runRules(run, e)) ||
  (!run.policyKey && !run.requestedTopic && !runRules(run, e).forbiddenTopics?.length)
