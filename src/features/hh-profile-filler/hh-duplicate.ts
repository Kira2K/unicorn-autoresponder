import type { Page } from 'playwright'
import { profileFillerError } from './errors.ts'

// HH's native Duplicate button posts this endpoint and follows data.url.
// Unlike the resume-list menu, it also works when HH redirects to a draft wizard.
// One POST only: a lost response is an uncertain write, never a retry condition.
export async function requestNativeResumeClone(page: Page, sourceId: string,
  recordCreated: (id: string) => void): Promise<string> {
  if (!/^[a-z0-9]+$/i.test(sourceId) || new URL(page.url()).origin !== 'https://hh.ru') {
    throw profileFillerError('profile_hh_duplicate_invalid_source',
      'Native duplication requires a known HH resume and an authorized HH page.', 'duplicate_resume')
  }
  let response: { status: number; url?: string; error?: string }
  try {
    response = await page.evaluate(async id => {
      const token = document.cookie.split('; ').find(item => item.startsWith('_xsrf='))?.slice(6)
      if (!token) return { status: 403 }
      const result = await fetch(`/applicant/resumes/clone?resume=${encodeURIComponent(id)}`, {
        method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(30_000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'X-Xsrftoken': decodeURIComponent(token) }, body: '{}'
      })
      const data = await result.json()
      return { status: result.status, url: data.url, error: data.error }
    }, sourceId)
  } catch {
    throw profileFillerError('profile_hh_duplicate_outcome_unknown',
      'HH clone response was lost. Inspect existing drafts before any new clone request.', 'duplicate_resume')
  }
  if (response.error === 'max_resume_limit_exceeded') throw profileFillerError(
    'profile_hh_resume_limit', 'HH resume limit prevents native duplication.', 'duplicate_resume')
  if (response.status >= 400 && response.status < 500) throw profileFillerError(
    'profile_hh_duplicate_rejected', `HH rejected native duplication (HTTP ${response.status}).`,
    'duplicate_resume')
  let destination: URL | undefined
  try { destination = new URL(response.url ?? '', 'https://hh.ru') } catch { /* validate below */ }
  const id = destination?.searchParams.get('resume')
  if (response.status !== 200 || destination?.origin !== 'https://hh.ru' ||
      !/^\/profile\/resume\/?$/.test(destination.pathname) || !id ||
      !/^[a-z0-9]+$/i.test(id) || id === sourceId) throw profileFillerError(
    'profile_hh_duplicate_outcome_unknown',
    'HH did not return a distinct clone ID. Inspect existing drafts before another clone request.',
    'duplicate_resume')
  // Persist before navigation or editing, so recovery reuses this exact clone.
  recordCreated(id)
  return id
}
