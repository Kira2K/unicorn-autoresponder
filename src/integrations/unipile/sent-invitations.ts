import type { Invitation } from '../../features/linkedin-automation/invitation-withdrawal/contracts.ts'
type ReadPage = (offset: number) => Promise<unknown>
const invalid = () => Object.assign(new Error('Не удалось получить полный список приглашений. Обновите список.'),
  { code: 'withdrawal_list_invalid' })
// LinkedIn V2 paginates by offset. A short nonempty page does not prove completion.
export async function readAllSentInvitations(readPage: ReadPage): Promise<Invitation[]> {
  const items: Invitation[] = [], ids = new Set<string>()
  let expectedTotal: number | undefined
  for (let page = 0; page < 10_000; page++) {
    const response = await readPage(items.length) as any
    if (!response || !Array.isArray(response.data)) throw invalid()
    if (response.total_count !== undefined) {
      if (!Number.isInteger(response.total_count) || response.total_count < 0 ||
        (expectedTotal !== undefined && expectedTotal !== response.total_count)) throw invalid()
      expectedTotal = response.total_count
    }
    for (const item of response.data) {
      if (typeof item?.id !== 'string' || !item.id || item.type !== 'sent' || ids.has(item.id)) throw invalid()
      ids.add(item.id)
      items.push({ id: item.id, name: typeof item.user?.display_name === 'string' ? item.user.display_name : item.id,
        ...(typeof item.created_at === 'string' ? { createdAt: item.created_at } : {}) })
    }
    if (expectedTotal !== undefined && items.length > expectedTotal) throw invalid()
    if (!response.data.length || items.length === expectedTotal) {
      if (expectedTotal !== undefined && items.length !== expectedTotal) throw invalid()
      return items
    }
  }
  throw invalid()
}
