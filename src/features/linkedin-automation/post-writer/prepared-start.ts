import { PostError } from './errors.ts'
import { validatePreparedPosts } from './prepared-posts.ts'
import { moscowDate, scheduledId } from './schedule.ts'
import { accountActive, newRun } from './run-actions.ts'
import type { Execution } from './execution-types.ts'
import type { PostRun, Settings } from './types.ts'

// Reuse the day's ID for both manual and scheduled starts. Never reset an existing run.
export async function startPreparedPost(settings: Settings, input: unknown, runs: Map<string, PostRun>,
  e: Pick<Execution, 'save' | 'writerId' | 'now' | 'memes'>): Promise<PostRun> {
  const [post] = validatePreparedPosts([input])
  const id = scheduledId(settings.account, post.date), existing = runs.get(id)
  if (existing) {
    if (existing.preparedPost?.text !== post.text) throw new PostError('post_prepared_day_started')
    return structuredClone(existing)
  }
  if (settings.contentMode !== 'prepared' ||
    settings.preparedPosts?.find(item => item.date === post.date)?.text !== post.text) {
    throw new PostError('post_prepared_changed')
  }
  if (post.date < moscowDate(e.now())) throw new PostError('post_prepared_past')
  if (!e.memes?.enabled) throw new PostError('meme_generation_disabled')
  if (accountActive(runs.values(), settings.account)) throw new PostError('post_account_busy')
  const run = newRun(id, settings.account, 'manual', 'automatic', settings.likes, e)
  run.preparedPost = { ...post }
  run.memeEnabled = true
  await e.save(run)
  return structuredClone(run)
}
