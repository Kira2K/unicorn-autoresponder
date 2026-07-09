const MANUAL_LIST_STORAGE_URL = 'https://hh.ru/'
const DEFAULT_TIMEOUT_MS = 150000
const DEFAULT_MAX_CHECKS = 200
const DEFAULT_MANUAL_LIST_KEY = 'hh_ar_v2_manual_list'
const { normalizeHhUrl } = require('./shared/hh-url.ts')
const { isPageClosedError } = require('../../platform/browser/page-utils.ts')

const APPLY_BUTTON_SELECTOR = [
  '[data-qa="vacancy-response-link-top"]',
  'a[data-qa="vacancy-response-link-top"]',
  'button[data-qa="vacancy-response-link-top"]',
  '[data-qa="vacancy-serp__vacancy_response"]',
  'button[data-qa="vacancy-serp__vacancy_response"]'
].join(', ')

type ManualVacanciesCleanupOptions = {
  manualListKey?: string
  maxChecks?: number
  timeoutMs?: number
  log?: (message: string) => void
}

type ManualVacancyEntry = {
  vid?: string
  url?: string
  returnUrl?: string
  ts?: number
  title?: string
}

type ManualVacancyCleanupItem = {
  id: string
  url: string
  title?: string
  action: 'removed' | 'kept'
  reason: string
}

type ManualVacanciesCleanupResult = {
  skipped: boolean
  completed: boolean
  initialCount: number
  checkedCount: number
  removedCount: number
  remainingCount: number
  keptCount: number
  error?: string
  items: ManualVacancyCleanupItem[]
}

function isPageUnavailable(page: any, error?: unknown): boolean {
  return Boolean(page?.isClosed?.()) || (error !== undefined && isPageClosedError(error))
}

function makeCleanupUnavailableResult(options: {
  reason: string
  initialCount?: number
  checkedCount?: number
  removedCount?: number
  items?: ManualVacancyCleanupItem[]
}): ManualVacanciesCleanupResult {
  const initialCount = options.initialCount ?? 0
  const checkedCount = options.checkedCount ?? 0
  const removedCount = options.removedCount ?? 0
  const items = options.items ?? []
  const keptCount = items.filter((item) => item.action === 'kept').length
  const remainingCount = Math.max(initialCount - removedCount, 0)

  return {
    skipped: true,
    completed: initialCount === 0,
    initialCount,
    checkedCount,
    removedCount,
    remainingCount,
    keptCount,
    error: options.reason,
    items
  }
}

function getVacancyIdFromValue(value: unknown): string | undefined {
  if (!value) {
    return undefined
  }

  const text = String(value)
  const vidMatch = text.match(/^v_(\d+)$/)

  if (vidMatch?.[1]) {
    return vidMatch[1]
  }

  try {
    const parsedUrl = new URL(text, 'https://hh.ru')
    const pathMatch = parsedUrl.pathname.match(/\/vacancy\/(\d+)/)
    const queryId = parsedUrl.searchParams.get('vacancyId')

    return pathMatch?.[1] || queryId || undefined
  } catch {
    const pathMatch = text.match(/\/vacancy\/(\d+)/)
    const queryMatch = text.match(/[?&]vacancyId=(\d+)/)

    return pathMatch?.[1] || queryMatch?.[1]
  }
}

function getVacancyId(entry: ManualVacancyEntry): string | undefined {
  return (
    getVacancyIdFromValue(entry.vid) ||
    getVacancyIdFromValue(entry.url) ||
    getVacancyIdFromValue(entry.returnUrl)
  )
}

function getEntryKey(entry: ManualVacancyEntry): string {
  const vacancyId = getVacancyId(entry)

  return String(entry.vid || vacancyId || entry.url || entry.returnUrl || '')
}

function getCheckUrl(entry: ManualVacancyEntry): string | undefined {
  const vacancyId = getVacancyId(entry)

  if (vacancyId) {
    return `https://hh.ru/vacancy/${vacancyId}`
  }

  const normalizedUrl = normalizeHhUrl(entry.url)

  if (normalizedUrl && new URL(normalizedUrl).pathname.startsWith('/vacancy/')) {
    return normalizedUrl
  }

  return undefined
}

async function openManualListStorage(page: any, timeoutMs: number): Promise<void> {
  await page.goto(MANUAL_LIST_STORAGE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs
  })
  await page.waitForLoadState('load', {
    timeout: timeoutMs
  }).catch(() => undefined)
}

async function getManualVacancies(page: any, manualListKey: string): Promise<ManualVacancyEntry[]> {
  if (isPageUnavailable(page)) {
    return []
  }

  return page.evaluate((storageKey: string) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]')

      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }, manualListKey)
}

async function removeManualVacancy(
  page: any,
  manualListKey: string,
  target: ManualVacancyEntry
): Promise<boolean> {
  const targetId = getVacancyId(target)

  return page.evaluate(
    ({ storageKey, targetEntry, vacancyId }: { storageKey: string; targetEntry: ManualVacancyEntry; vacancyId?: string }) => {
      function getBrowserVacancyId(value: unknown): string | undefined {
        if (!value) {
          return undefined
        }

        const text = String(value)
        const vidMatch = text.match(/^v_(\d+)$/)

        if (vidMatch?.[1]) {
          return vidMatch[1]
        }

        try {
          const parsedUrl = new URL(text, 'https://hh.ru')
          const pathMatch = parsedUrl.pathname.match(/\/vacancy\/(\d+)/)
          const queryId = parsedUrl.searchParams.get('vacancyId')

          return pathMatch?.[1] || queryId || undefined
        } catch {
          const pathMatch = text.match(/\/vacancy\/(\d+)/)
          const queryMatch = text.match(/[?&]vacancyId=(\d+)/)

          return pathMatch?.[1] || queryMatch?.[1]
        }
      }

      function isSameEntry(entry: ManualVacancyEntry): boolean {
        if (targetEntry.vid && entry.vid === targetEntry.vid) {
          return true
        }

        if (targetEntry.url && entry.url === targetEntry.url) {
          return true
        }

        if (!vacancyId) {
          return false
        }

        return [entry.vid, entry.url, entry.returnUrl].some((value) => getBrowserVacancyId(value) === vacancyId)
      }

      let list: ManualVacancyEntry[] = []

      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]')
        list = Array.isArray(parsed) ? parsed : []
      } catch {
        list = []
      }

      const nextList = list.filter((entry) => !isSameEntry(entry))
      localStorage.setItem(storageKey, JSON.stringify(nextList))

      return nextList.length < list.length
    },
    {
      storageKey: manualListKey,
      targetEntry: target,
      vacancyId: targetId
    }
  )
}

async function getVacancyResponseState(page: any): Promise<{
  hasApplyButton: boolean
  hasAlreadyRespondedText: boolean
}> {
  return page.evaluate((applyButtonSelector: string) => {
    function isVisible(element: Element): boolean {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)

      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }

    const pageText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const alreadyRespondedTexts = [
      'вы откликнулись',
      'отклик отправлен',
      'отклик был отправлен',
      'резюме доставлено',
      'сопроводительное письмо отправлено'
    ]

    return {
      hasApplyButton: Array.from(document.querySelectorAll(applyButtonSelector)).some(isVisible),
      hasAlreadyRespondedText: alreadyRespondedTexts.some((text) => pageText.includes(text))
    }
  }, APPLY_BUTTON_SELECTOR)
}

async function runManualVacanciesCleanup(
  page: any,
  options: ManualVacanciesCleanupOptions = {}
): Promise<ManualVacanciesCleanupResult> {
  const manualListKey = options.manualListKey ?? DEFAULT_MANUAL_LIST_KEY
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxChecks = options.maxChecks ?? DEFAULT_MAX_CHECKS
  const log = options.log ?? (() => undefined)
  const items: ManualVacancyCleanupItem[] = []
  const keptKeys = new Set<string>()
  let checkedCount = 0
  let removedCount = 0

  if (isPageUnavailable(page)) {
    log('Manual vacancies cleanup skipped: page is already closed')

    return makeCleanupUnavailableResult({
      reason: 'manual vacancies cleanup skipped because page is already closed'
    })
  }

  try {
    await openManualListStorage(page, timeoutMs)
  } catch (error: unknown) {
    if (isPageUnavailable(page, error)) {
      log('Manual vacancies cleanup skipped: cleanup page closed while opening storage')

      return makeCleanupUnavailableResult({
        reason: 'cleanup page closed while opening manual vacancies storage'
      })
    }

    throw error
  }

  let manualVacancies: ManualVacancyEntry[]

  try {
    manualVacancies = await getManualVacancies(page, manualListKey)
  } catch (error: unknown) {
    if (isPageUnavailable(page, error)) {
      log('Manual vacancies cleanup skipped: cleanup page closed while reading storage')

      return makeCleanupUnavailableResult({
        reason: 'cleanup page closed while reading manual vacancies storage'
      })
    }

    throw error
  }
  const initialCount = manualVacancies.length

  if (!initialCount) {
    log('Manual vacancies cleanup skipped: list is empty')

    return {
      skipped: true,
      completed: true,
      initialCount,
      checkedCount,
      removedCount,
      remainingCount: 0,
      keptCount: 0,
      items
    }
  }

  log(`Manual vacancies cleanup started: ${initialCount} vacancies`)

  while (manualVacancies.length && checkedCount < maxChecks) {
    const vacancy = manualVacancies.find((entry) => !keptKeys.has(getEntryKey(entry)))

    if (!vacancy) {
      break
    }

    checkedCount += 1
    const vacancyId = getVacancyId(vacancy)
    const checkUrl = getCheckUrl(vacancy)
    const outputUrl = checkUrl || normalizeHhUrl(vacancy.url) || normalizeHhUrl(vacancy.returnUrl) || ''

    if (!checkUrl) {
      keptKeys.add(getEntryKey(vacancy))
      items.push({
        id: getEntryKey(vacancy),
        url: outputUrl,
        title: vacancy.title,
        action: 'kept',
        reason: 'vacancy id was not found in manual list entry'
      })
      log(`Manual vacancy kept: ${getEntryKey(vacancy)} has no vacancy id`)
      try {
        manualVacancies = await getManualVacancies(page, manualListKey)
      } catch (error: unknown) {
        if (isPageUnavailable(page, error)) {
          return makeCleanupUnavailableResult({
            reason: 'cleanup page closed while refreshing manual vacancies',
            initialCount,
            checkedCount,
            removedCount,
            items
          })
        }

        throw error
      }
      continue
    }

    try {
      await page.goto(checkUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      })
      await page.waitForLoadState('load', {
        timeout: timeoutMs
      }).catch(() => undefined)
    } catch (error: unknown) {
      if (isPageUnavailable(page, error)) {
        return makeCleanupUnavailableResult({
          reason: 'cleanup page closed while checking manual vacancy',
          initialCount,
          checkedCount,
          removedCount,
          items
        })
      }

      throw error
    }

    let responseState: {
      hasApplyButton: boolean
      hasAlreadyRespondedText: boolean
    }

    try {
      responseState = await getVacancyResponseState(page)
    } catch (error: unknown) {
      if (isPageUnavailable(page, error)) {
        return makeCleanupUnavailableResult({
          reason: 'cleanup page closed while reading manual vacancy state',
          initialCount,
          checkedCount,
          removedCount,
          items
        })
      }

      throw error
    }
    const shouldRemove = !responseState.hasApplyButton || responseState.hasAlreadyRespondedText

    if (!shouldRemove) {
      keptKeys.add(getEntryKey(vacancy))
      items.push({
        id: vacancyId || getEntryKey(vacancy),
        url: checkUrl,
        title: vacancy.title,
        action: 'kept',
        reason: 'apply button is still available'
      })
      log(`Manual vacancy kept: ${vacancyId || getEntryKey(vacancy)} still has apply button`)
      try {
        manualVacancies = await getManualVacancies(page, manualListKey)
      } catch (error: unknown) {
        if (isPageUnavailable(page, error)) {
          return makeCleanupUnavailableResult({
            reason: 'cleanup page closed while refreshing manual vacancies',
            initialCount,
            checkedCount,
            removedCount,
            items
          })
        }

        throw error
      }
      continue
    }

    let removed: boolean

    try {
      removed = await removeManualVacancy(page, manualListKey, vacancy)
    } catch (error: unknown) {
      if (isPageUnavailable(page, error)) {
        return makeCleanupUnavailableResult({
          reason: 'cleanup page closed while removing manual vacancy',
          initialCount,
          checkedCount,
          removedCount,
          items
        })
      }

      throw error
    }

    if (!removed) {
      keptKeys.add(getEntryKey(vacancy))
      items.push({
        id: vacancyId || getEntryKey(vacancy),
        url: checkUrl,
        title: vacancy.title,
        action: 'kept',
        reason: 'already responded, but manual list entry was not removed'
      })
      log(`Manual vacancy kept: ${vacancyId || getEntryKey(vacancy)} could not be removed`)
    } else {
      removedCount += 1
      items.push({
        id: vacancyId || getEntryKey(vacancy),
        url: checkUrl,
        title: vacancy.title,
        action: 'removed',
        reason: responseState.hasAlreadyRespondedText
          ? 'already responded text found'
          : 'apply button is absent'
      })
      log(`Manual vacancy removed: ${vacancyId || getEntryKey(vacancy)}`)
    }

    try {
      manualVacancies = await getManualVacancies(page, manualListKey)
    } catch (error: unknown) {
      if (isPageUnavailable(page, error)) {
        return makeCleanupUnavailableResult({
          reason: 'cleanup page closed while refreshing manual vacancies',
          initialCount,
          checkedCount,
          removedCount,
          items
        })
      }

      throw error
    }
  }

  const remainingCount = manualVacancies.length
  const keptCount = items.filter((item) => item.action === 'kept').length
  log(
    `Manual vacancies cleanup finished: ${removedCount} successfully removed, ` +
    `${remainingCount} remaining, ${keptCount} kept`
  )

  return {
    skipped: false,
    completed: remainingCount === 0,
    initialCount,
    checkedCount,
    removedCount,
    remainingCount,
    keptCount,
    items
  }
}

module.exports = {
  MANUAL_LIST_STORAGE_URL,
  runManualVacanciesCleanup
}
