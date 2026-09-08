import { PostError, object } from './errors.ts'
import { topicList } from './content-rules.ts'
import type { TextAuthor } from './text-workspace-types.ts'
export const authorId = (value: string) => {
  if (!/^[a-z0-9_-]{1,80}$/i.test(value)) throw new PostError('post_author_id_invalid')
  return value
}
export function parseAuthor(id: string, input: unknown, previous?: TextAuthor): TextAuthor {
  const value = object(input)
  if (value.memes !== undefined && typeof value.memes !== 'boolean') throw new PostError('post_author_invalid')
  const text = (key: string, required = false) => {
    const item = value[key] ?? ''
    if (typeof item !== 'string' || item.length > 500 || (required && !item.trim())) {
      throw new PostError('post_author_invalid')
    }
    return item.trim()
  }
  return { id: authorId(id), name: text('name', true), role: text('role', true), level: text('level'),
    audience: text('audience'), style: text('style'), stack: topicList(value.stack ?? []),
    forbiddenTopics: topicList(value.forbiddenTopics ?? []), cvRef: previous?.cvRef,
    memes: value.memes === undefined ? previous?.memes ?? false : value.memes }
}
