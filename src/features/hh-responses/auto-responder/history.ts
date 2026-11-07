const HISTORY = 'hh_ar_v2_processed_ids'
const SUCCESSES = 'hh_ar_v2_successful_response_ids'

function mergeSuccessfulVacancies(history: unknown[], successes: unknown[]): string[] {
  const ids = new Set(history.filter((id): id is string => typeof id === 'string' && /^v_\d+$/.test(id)))
  for (const value of successes) {
    const match = typeof value === 'string' && value.match(/^(v_\d+)(?::|$)/)
    if (match) ids.add(match[1])
  }
  return [...ids]
}

// Recover confirmations from restored HH tabs before opening a new scenario.
// Failed/skipped/visibility-blocked vacancies are deliberately not made durable.
async function preserveSuccessfulVacancyHistory(context: { pages(): any[] }): Promise<number> {
  const pages = context.pages().filter(page => /^https:\/\/([\w-]+\.)?hh\.ru\//i.test(page.url()))
  let ids: string[] = [], readCount = 0
  for (const page of pages) {
    try {
      const saved = await page.evaluate(({ historyKey, successKey }: any) => {
        const array = (raw: string | null) => { try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }
        return { history: array(localStorage.getItem(historyKey)), successful: array(sessionStorage.getItem(successKey)) }
      }, { historyKey: HISTORY, successKey: SUCCESSES })
      ids = mergeSuccessfulVacancies([...ids, ...saved.history], saved.successful)
      readCount++
    } catch { /* One tab navigating must not erase another tab's confirmations. */ }
  }
  if (pages.length && !readCount) throw new Error('Cannot read HH confirmation history before starting a new tab')
  let writes = 0
  for (const page of pages) {
    try {
      await page.evaluate((confirmed: string[]) => {
        const key = 'hh_ar_v2_processed_ids'
        let existing: string[] = []
        const parsed = JSON.parse(localStorage.getItem(key) || '[]')
        if (!Array.isArray(parsed)) throw new Error('HH history is not an array; preserving it unchanged')
        existing = parsed
        localStorage.setItem(key, JSON.stringify([...new Set([...existing, ...confirmed])]))
      }, ids)
      writes++
    } catch { /* Preserve the source tab and try another HH tab. */ }
  }
  if (ids.length && !writes) throw new Error('Cannot preserve HH confirmation history before starting a new tab')
  return ids.length
}
module.exports = { mergeSuccessfulVacancies, preserveSuccessfulVacancyHistory }
