import { createServer } from 'node:net'
import { PostError } from './errors.ts'

// All local worktrees share this exclusive port. No PID-based identity or stale file cleanup.
export async function acquirePostWriterLease(writerId: string, port = 4439) {
  if (!/^[a-z0-9_-]{3,80}$/i.test(writerId)) throw new PostError('post_writer_id_missing')
  const server = createServer(socket => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new PostError('post_writer_already_running')))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve)
  })
  server.unref()
  return () => server.close()
}
