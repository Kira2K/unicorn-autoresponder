import { topicList, rulesKey } from './content-rules.ts'
import type { TextJob, TextAuthor } from './text-workspace-types.ts'
import type { JsonFiles } from './json-files.ts'
export async function textRules(job: TextJob, files: JsonFiles) {
  const current = await files.get<TextAuthor>('authors', job.author)
  return { requestedTopic: job.requestedTopic, forbiddenTopics: topicList([...new Set([
    ...await files.get<string[]>('policy', 'global') ?? [], ...(current?.forbiddenTopics ?? [])])], 100) }
}
export async function invalidateTextRules(files: JsonFiles, author?: string) {
  for (const job of await files.list<TextJob>('text-jobs')) {
    if (job.status !== 'ready' || (author !== undefined && author !== job.author)) continue
    if (job.policyKey === rulesKey(await textRules(job, files))) continue
    job.status = 'queued'
    await files.put('text-jobs', job.id, job)
  }
}
