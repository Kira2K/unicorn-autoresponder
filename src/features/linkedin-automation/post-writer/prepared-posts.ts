import { PostError } from './errors.ts'
import type { PreparedPost, PostRun, Settings } from './types.ts'

export const PREPARED_POST_MAX = 3000
export function validatePreparedPosts(input: unknown): PreparedPost[] {
  if (!Array.isArray(input) || input.length > 7) throw new PostError('post_prepared_invalid')
  const dates = new Set<string>()
  const result = input.map(value => {
    if (!value || typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
      !Number.isFinite(Date.parse(`${value.date}T00:00:00Z`)) ||
      new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date ||
      dates.has(value.date) || typeof value.text !== 'string' || !value.text.trim() ||
      Array.from(value.text).length > PREPARED_POST_MAX || value.text.includes('\0')) {
      throw new PostError('post_prepared_invalid')
    }
    dates.add(value.date)
    return { date: value.date, text: value.text }
  }).sort((a, b) => a.date.localeCompare(b.date))
  if (result.length > 1 && Date.parse(result.at(-1)!.date) - Date.parse(result[0].date) > 6 * 86_400_000) {
    throw new PostError('post_prepared_invalid')
  }
  return result
}

// A started run owns its text. Editing future days must not replace that snapshot.
export function assertPreparedEdits(previous: Settings, next: Settings, runs: Iterable<PostRun>) {
  const started = new Set([...runs].filter(run => run.account === next.account && run.trigger === 'scheduled')
    .map(run => run.id))
  for (const post of next.preparedPosts ?? []) {
    if (started.has(`scheduled-${next.account}-${post.date}`) &&
      previous.preparedPosts?.find(item => item.date === post.date)?.text !== post.text) {
      throw new PostError('post_prepared_day_started')
    }
  }
}
