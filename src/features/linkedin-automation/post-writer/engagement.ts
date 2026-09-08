import { lock, unlock, type EngagementExecution } from './execution-types.ts'
import type { PostRun } from './types.ts'

export async function engage(run: PostRun, e: EngagementExecution) {
  if (e.isClosing?.()) return
  if (!run.postId || !['pending', 'running', 'uncertain'].includes(run.engagement.status)) return
  const uncertain = run.engagement.items.find(item => ['sending', 'uncertain'].includes(item.status))
  if (uncertain) {
    lock(e, uncertain.account.platformAccountId, run.id)
    const found = await e.adapter.reacted(uncertain.account, run.postId)
    if (!found) {
      uncertain.status = 'uncertain'
      run.engagement.status = 'uncertain'
      run.nextActionAt = e.now() + 5 * 60_000
      await e.save(run)
      return
    }
    uncertain.status = 'sent'
    uncertain.confirmedAt = e.now()
    run.engagement.status = 'running'
    run.nextActionAt = e.now() + 5000 + Math.floor(e.random() * 85_001)
    await e.save(run)
    unlock(e, uncertain.account.platformAccountId)
    return
  }
  if (run.stop || !run.likesEnabled || !e.settings(run.account).likes) {
    run.engagement.items.forEach(item => { if (item.status === 'pending') item.status = 'cancelled' })
    run.engagement.status = 'cancelled'
    run.nextActionAt = undefined
    await e.save(run)
    return
  }
  if (run.engagement.status === 'pending') {
    run.engagement.target = e.random() < 0.5 ? 6 : 7
    const ids = new Set<string>()
    const available = (await e.source.accounts()).filter(account => {
      if (account.verifiedProviderId === run.target?.verifiedProviderId || ids.has(account.verifiedProviderId)) return false
      ids.add(account.verifiedProviderId)
      return true
    }).map(account => ({ account, order: e.random() })).sort((a, b) => a.order - b.order)
    run.engagement.items = available.slice(0, run.engagement.target).map(({ account }) =>
      ({ account, status: 'pending' }))
    run.engagement.status = 'running'
    run.nextActionAt = e.now() + 5000 + Math.floor(e.random() * 85_001)
    await e.save(run)
    return
  }
  const item = run.engagement.items.find(row => row.status === 'pending')
  if (!item) {
    const sent = run.engagement.items.filter(row => row.status === 'sent').length
    run.engagement.status = sent >= run.engagement.target ? 'completed' : 'partial'
    run.nextActionAt = undefined
    await e.save(run)
    return
  }
  lock(e, item.account.platformAccountId, run.id)
  await e.adapter.identity(item.account)
  if (await e.adapter.reacted(item.account, run.postId)) {
    item.status = 'sent'
    item.confirmedAt = e.now()
    await e.save(run)
    unlock(e, item.account.platformAccountId)
    return
  }
  if (run.stop || e.isClosing?.() || !e.settings(run.account).likes) { unlock(e, item.account.platformAccountId); return }
  item.status = 'sending'
  item.attemptedAt = e.now()
  await e.save(run)
  if (run.stop || e.isClosing?.() || !e.settings(run.account).likes) {
    item.status = 'cancelled'
    await e.save(run)
    unlock(e, item.account.platformAccountId)
    return
  }
  await e.adapter.like(item.account, run.postId)
  run.nextActionAt = e.now() + 5000
  await e.save(run)
}
