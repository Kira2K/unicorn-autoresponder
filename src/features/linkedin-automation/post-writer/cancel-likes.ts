import type { Execution } from './execution-types.ts'
import type { PostRun } from './types.ts'

export async function cancelRemainingLikes(account: number, runs: Iterable<PostRun>, e: Pick<Execution, 'save'>) {
  for (const run of runs) {
    if (run.account !== account || !run.likesEnabled) continue
    run.likesEnabled = false
    for (const item of run.engagement.items) if (item.status === 'pending') item.status = 'cancelled'
    const unresolved = run.engagement.items.some(item => ['sending', 'uncertain'].includes(item.status))
    if (!unresolved && ['pending', 'running'].includes(run.engagement.status)) {
      run.engagement.status = 'cancelled'
      if (run.status === 'published') run.nextActionAt = undefined
    }
    await e.save(run)
  }
}
