import type { TrackedPost } from './types.ts'

// Add a confirmed publication without replacing session counters, queued replies or deduplication evidence.
export function includePublication(posts: TrackedPost[], publication?: TrackedPost): TrackedPost[] {
  if (!publication || posts.some(p=>p.id===publication.id)) return posts
  return [publication,...posts].sort((a,b)=>(Date.parse(b.createdAt??'')||0)-(Date.parse(a.createdAt??'')||0)).slice(0,2)
}
