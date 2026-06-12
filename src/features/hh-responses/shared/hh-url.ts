const HH_AUTO_RESPONDER_URL_PATTERNS = [
  /^https?:\/\/([^/?#]+\.)?hh\.ru\/search\/vacancy(?:[/?#]|$)/i,
  /^https?:\/\/([^/?#]+\.)?hh\.ru\/vacancy\/[^/?#]+/i,
  /^https?:\/\/([^/?#]+\.)?hh\.ru\/applicant\/vacancy_response(?:[/?#]|$)/i
]

function isAutoResponderUrl(url: string): boolean {
  return HH_AUTO_RESPONDER_URL_PATTERNS.some(pattern => pattern.test(url))
}

function getVacancyIdFromUrl(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url)
    const pathMatch = parsedUrl.pathname.match(/\/vacancy\/(\d+)/)

    if (pathMatch?.[1]) {
      return pathMatch[1]
    }

    return parsedUrl.searchParams.get('vacancyId') || undefined
  } catch {
    const pathMatch = url.match(/\/vacancy\/(\d+)/)
    const queryMatch = url.match(/[?&]vacancyId=(\d+)/)

    return pathMatch?.[1] || queryMatch?.[1]
  }
}

function normalizeHhUrl(rawUrl: unknown): string | undefined {
  if (!rawUrl) {
    return undefined
  }

  try {
    const parsedUrl = new URL(String(rawUrl), 'https://hh.ru')

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return undefined
    }

    if (!/(^|\.)hh\.ru$/i.test(parsedUrl.hostname)) {
      return undefined
    }

    return parsedUrl.href
  } catch {
    return undefined
  }
}

module.exports = {
  HH_AUTO_RESPONDER_URL_PATTERNS,
  getVacancyIdFromUrl,
  isAutoResponderUrl,
  normalizeHhUrl
}
