import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import type { BrowserContext, Page, Request, Response } from 'playwright'
import { inspectForm, fillFields, verifyFields } from './form-fields.ts'
import { classifyOutcome } from './outcome.ts'
import { captchaVerificationComplete, visibleCaptchaChallenge } from './captcha.ts'
import { canonicalUrl } from '../infrastructure/identity.ts'
import { inspectGurtam, fillGurtam, verifyGurtam } from './engines/gurtam.ts'
import { currentSumupPostingUrl, observedSumupApplicationUrl, safeApplicationEvidenceUrl, sumupPostingId } from './engines/sumup.ts'
import { evaluatePublicationDate } from '../vacancy_collection/publication-date-precheck.ts'
import { cleanPostingHtml } from '../vacancy_collection/ats-reader.ts'
import { decisionRulesHash, type SelectionRules } from '../stack_classification/rules.ts'
import type { ApplicationAdapter, Outcome } from '../types.ts'

export { observedSumupApplicationUrl } from './engines/sumup.ts'

const hosts = {
  ashby: (h: string) => h === 'jobs.ashbyhq.com',
  greenhouse: (h: string) => /^(job-boards|boards)(\.eu)?\.greenhouse\.io$/.test(h),
  lever: (h: string) => /^jobs\.(eu\.)?lever\.co$/.test(h),
  bamboohr: (h: string) => /^(?!www\.|api\.|app\.)[a-z0-9-]+\.bamboohr\.com$/.test(h),
  recruitee: (h: string) => h.endsWith('.recruitee.com'),
  gurtam: (h: string) => h === 'gurtam.com' || h === 'www.gurtam.com',
  sumup: (h: string) => h === 'www.sumup.com' || h === 'sumup.com'
}
// Keep only diagnostic codes and explicit success markers; never persist raw responses containing PII/tokens.
export function responseMarkers(body: string, status: number) {
  const markers: string[] = body.match(/RECAPTCHA_SCORE_BELOW_THRESHOLD|FormSubmitSuccess|captchaToken.{0,30}(?:invalid|required)|Missing entry for required field|flagged.{0,30}spam|"errors"\s*:\s*\[\s*\{/gi) ?? []
  if (status === 428) markers.push('HTTP 428')
  if (status >= 400) markers.push(`HTTP ${status}`)
  return markers
}
type TabEvidence = {
  positionId: string; responses: string[]; pending: Set<Promise<void>>; writes: Set<Request>
  lastWrite: number; saveFailed: boolean; submitClicked: boolean; challengeSeen: boolean
  applicationRequests: number; applicationRequestFailed: boolean
  navigationChanged?: boolean
  uploadedResume?: { keys: string[]; fileName: string; sha256: string }
  uploadVerifiedKeys?: string[]
  continuationClicked?: boolean
  opaqueChallengeSeen?: boolean
  opaqueChallengeBaseline?: Map<string, { width: number; height: number }>
  trace?: { path: string; pending: Promise<void>; failed: boolean; requests: number; finished: number; failedRequests: number }
}
const tabEvidence = new WeakMap<Page, TabEvidence>()
const detachHandlers = new WeakMap<Page, () => void>()
function possibleApplicationWrite(request: Request): boolean {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method()) || /ApiSetFormValue/.test(request.postData() ?? '')) return false
  try { return !/(^|\.)(hcaptcha\.com|google\.com|recaptcha\.net)$/.test(new URL(request.url()).hostname) }
  catch { return true }
}

export function mayContinueAfterCaptcha(state: Pick<TabEvidence, 'submitClicked' | 'challengeSeen' | 'applicationRequests' | 'applicationRequestFailed' | 'navigationChanged' | 'continuationClicked'>, ready: boolean, challengeVisible: boolean): boolean {
  return state.submitClicked && state.challengeSeen && !state.applicationRequests && !state.applicationRequestFailed && !state.navigationChanged && !state.continuationClicked && ready && !challengeVisible
}
export function classifyObservedOutcome(text: string, url: string, responses: string[]): Outcome {
  const visibleReceipt = classifyOutcome({ text, url, responses: [] })
  return visibleReceipt.status === 'succeeded' ? visibleReceipt : classifyOutcome({ text, url, responses })
}
/** A provider frame that opens or expands after Submit is a potential opaque challenge.
 * Existing passive widgets remain part of the baseline and do not trigger a handoff. */
async function providerFrameBaseline(page: Page): Promise<Map<string, { width: number; height: number }>> {
  const found = new Map<string, { width: number; height: number }>()
  for (const frame of await page.locator('iframe').all()) {
    const src = await frame.getAttribute('src').catch(() => null)
    let provider = false
    try { provider = !!src && /(^|\.)(hcaptcha\.com|google\.com|recaptcha\.net)$/.test(new URL(src, page.url()).hostname) } catch {}
    if (!provider || !src) continue
    const box = await frame.boundingBox().catch(() => null)
    if (box && await frame.isVisible().catch(() => false)) found.set(src, { width: box.width, height: box.height })
  }
  return found
}
async function newProviderChallenge(page: Page, before: Map<string, { width: number; height: number }>): Promise<boolean> {
  const now = await providerFrameBaseline(page)
  for (const [src, box] of now) {
    if (box.width <= 150 || box.height <= 150) continue
    const previous = before.get(src)
    if (!previous || box.width > previous.width + 100 || box.height > previous.height + 100) return true
  }
  return false
}
export type SumupPostingReview = { externalId: string; source: string; title: string; descriptionSha256: string; rulesHash: string; publishedAt: string; decision: 'eligible' | 'excluded' | 'review'; stackIds: string[] }
export function createAtsAdapters(options: { context: BrowserContext; evidenceRoot: string; outcomeTimeoutMs?: number; onVerificationPage?: (positionId: string, page: Page) => void; readSumupJob?: (url: string) => Promise<{ status: number; body: unknown }>; selectionRules?: SelectionRules; sumupReviews?: Record<string, SumupPostingReview>; stackId?: string }): ApplicationAdapter[] {
  return Object.entries(hosts).map(([name, supports]) => ({ name, version: name === 'gurtam' ? 'native-recruitment-form-v1' : name === 'sumup' ? 'observed-greenhouse-iframe-v1' : 'ats-forms-captcha-continuation-v1', supports: p => supports(new URL(p.applyUrl).hostname) && (name !== 'gurtam' || /^\/career\/[^/]+\/?$/.test(new URL(p.applyUrl).pathname)) && (name !== 'bamboohr' || /^\/careers\/\d+\/?$/.test(new URL(p.applyUrl).pathname)) && (name !== 'sumup' || !!sumupPostingId(new URL(p.applyUrl))), open: async position => {
    let url = position.applyUrl
    if (name === 'sumup') url = await currentSumupPostingUrl(url, options.readSumupJob ?? (async endpoint => {
      const response = await options.context.request.get(endpoint, { timeout: 20_000 })
      return { status: response.status(), body: response.ok() ? await response.json() : undefined }
    }), job => {
      if (!options.selectionRules) return
      const review = options.sumupReviews?.[position.id]
      if (!review || !options.stackId || review.externalId !== String(job.id) || review.source !== job.absolute_url || review.title !== job.title || review.publishedAt !== job.first_published || review.rulesHash !== decisionRulesHash(options.selectionRules) || review.descriptionSha256 !== createHash('sha256').update(cleanPostingHtml(job.content)).digest('hex')) throw Error('posting_content_review_required')
      const date = evaluatePublicationDate({ description: '', publishedAt: typeof job.first_published === 'string' ? job.first_published : undefined, retrievedAt: new Date().toISOString() }, options.selectionRules)
      if (date.decision === 'excluded') throw Error('posting_expired')
      if (date.decision !== 'continue' || date.status !== 'eligible') throw Error('posting_publication_review_required')
      if (review.decision !== 'eligible' || !review.stackIds.includes(options.stackId)) throw Error('posting_content_review_required')
    })
    if (name === 'ashby' && !url.includes('/application')) url = url.replace(/\/$/, '') + '/application'
    if (name === 'lever' && !/\/apply(?:[?#]|$)/.test(url)) url = url.replace(/\/$/, '') + '/apply'
    let observedApplicationUrl: string | undefined
    let page = options.context.pages().find(p => { try { return tabEvidence.get(p)?.positionId === position.id || canonicalUrl(p.url()) === canonicalUrl(url) } catch { return false } })
    if (!page) {
      page = await options.context.newPage()
      if (name === 'sumup' || name === 'gurtam') {
        const companyPage = page
        await page.route('**/*', async route => {
          const request = route.request()
          if (!request.isNavigationRequest() || request.frame() !== companyPage.mainFrame()) return route.fallback()
          try {
            const target = new URL(request.url())
            const sumupReceipt = name === 'sumup' && tabEvidence.get(companyPage)?.submitClicked && target.hostname === 'job-boards.greenhouse.io' && target.pathname === '/thanks'
            const valid = target.protocol === 'https:' && (name === 'gurtam' ? supports(target.hostname) && /^\/career\/[^/]+\/?$/.test(target.pathname) : target.toString() === url || !!observedApplicationUrl && target.toString() === observedApplicationUrl || sumupReceipt)
            if (!valid) return route.abort()
          } catch { return route.abort() }
          return route.fallback()
        })
      }
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40_000 }); await page.waitForTimeout(1200) }
      catch (error) { await page.close().catch(() => {}); throw error }
    }
    if (name === 'sumup' && supports(new URL(page.url()).hostname)) {
      // SumUp hydrates the Greenhouse iframe after the posting document loads.
      await page.locator('iframe[src*="/embed/job_app"]').first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {})
      const observed = observedSumupApplicationUrl(position.applyUrl, await page.locator('iframe[src]').evaluateAll(frames => frames.map(frame => (frame as HTMLIFrameElement).src)))
      observedApplicationUrl = observed
      await page.goto(observed, { waitUntil: 'domcontentloaded', timeout: 40_000 })
    }
    const tab = page
    options.onVerificationPage?.(position.id, tab)
    const state = tabEvidence.get(tab) ?? { positionId: position.id, responses: [], pending: new Set<Promise<void>>(), writes: new Set<Request>(), lastWrite: 0, saveFailed: false, submitClicked: false, challengeSeen: false, applicationRequests: 0, applicationRequestFailed: false }
    tabEvidence.set(tab, state)
    const { responses, pending, writes } = state
    const record = (event: string, extra: Record<string, string | number | boolean> = {}) => {
      if (!state.trace) return
      const current = state.trace
      current.pending = current.pending.then(() => appendFile(current.path, JSON.stringify({ at: new Date().toISOString(), event, ...extra }) + '\n', { mode: 0o600 })).catch(() => { current.failed = true })
    }
    const startTrace = async () => {
      await mkdir(resolve(options.evidenceRoot), { recursive: true })
      state.trace = { path: join(resolve(options.evidenceRoot), `${position.id}-request-${Date.now()}.jsonl`), pending: Promise.resolve(), failed: false, requests: 0, finished: 0, failedRequests: 0 }
      record('capture_started')
      await state.trace.pending
      if (state.trace.failed) throw Error('Application request trace could not be persisted before Submit')
    }
    await tab.locator('input[type="email"], textarea, form').first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
    const onNavigation = (frame: import('playwright').Frame) => { if (state.submitClicked && frame === tab.mainFrame()) state.navigationChanged = true }
    const onRequest = (request: Request) => {
      if (request.method() === 'POST' && /ApiSetFormValue/.test(request.postData() ?? '')) { writes.add(request); return }
      // Any non-provider write may be the application request, including ATS API subdomains.
      if (state.submitClicked && possibleApplicationWrite(request)) { state.applicationRequests++; if (state.trace) { state.trace.requests++; record('possible_application_request', { count: state.trace.requests }) } }
    }
    const onFinished = (request: Request) => { if (state.submitClicked && possibleApplicationWrite(request) && state.trace) { state.trace.finished++; record('request_finished', { count: state.trace.finished }) }; writes.delete(request) }
    const onFailed = (request: Request) => { if (writes.has(request)) state.saveFailed = true; else if (state.submitClicked && possibleApplicationWrite(request)) { state.applicationRequestFailed = true; if (state.trace) { state.trace.failedRequests++; record('request_failed', { count: state.trace.failedRequests }) } }; writes.delete(request) }
    const onResponse = (response: Response) => {
      const request = response.request()
      if (request.method() !== 'POST' || !supports(new URL(response.url()).hostname) && !/ashbyhq|greenhouse|lever|recruitee/.test(response.url())) return
      if (name === 'gurtam' && new URL(response.url()).pathname !== '/recruitment-application-form') return
      const work = (async () => {
        const body = await response.text().catch(() => '')
        responses.push(...responseMarkers(body, response.status()))
        if (name === 'gurtam') {
          try {
            const errors = JSON.parse(body).validationErrors
            if (Array.isArray(errors) && errors.length || errors && typeof errors === 'object' && Object.keys(errors).length) responses.push('validation_error')
          } catch { /* The response is not structured validation data. */ }
        }
        if (/ApiSetFormValue/i.test(request.postData() ?? '') && (response.status() >= 400 || /"errors"\s*:\s*\[\s*\{/.test(body))) state.saveFailed = true
        state.lastWrite = Date.now()
      })()
      pending.add(work); void work.finally(() => pending.delete(work))
    }
    const detach = () => { tab.off('response', onResponse); tab.off('request', onRequest); tab.off('requestfinished', onFinished); tab.off('requestfailed', onFailed); tab.off('framenavigated', onNavigation) }
    if (!detachHandlers.has(tab)) {
      tab.on('response', onResponse); tab.on('framenavigated', onNavigation)
      tab.on('request', onRequest); tab.on('requestfinished', onFinished); tab.on('requestfailed', onFailed)
      detachHandlers.set(tab, detach)
    }
    async function synchronize() {
      await tab.waitForTimeout(name === 'ashby' ? 1100 : 450)
      const until = Date.now() + 15_000
      while (writes.size && Date.now() < until) await tab.waitForTimeout(100)
      if (writes.size) throw Error('ATS autosave acknowledgment timed out')
      await Promise.all([...pending])
      if (state.lastWrite && Date.now() - state.lastWrite < 400) await tab.waitForTimeout(450)
      if (state.saveFailed) throw Error('ATS did not acknowledge saved form values')
    }
    async function observe(): Promise<Outcome> {
      await Promise.all([...pending])
      const classify = async () => {
        if (name === 'gurtam') {
          if (responses.includes('validation_error')) return { status: 'failed', reason: 'validation_error', detail: 'The employer returned form validation errors.' } as Outcome
          const receipt = tab.locator('.recruitment-applications.form-submitted .recruitment-applications-form-confirmation')
          if (await receipt.isVisible().catch(() => false) && /your application has been submitted successfully/i.test(await receipt.innerText())) return { status: 'succeeded', detail: 'Employer confirmation observed.' } as Outcome
          return classifyObservedOutcome('', tab.url(), responses)
        }
        return classifyObservedOutcome(await tab.locator('body').innerText(), tab.url(), responses)
      }
      let outcome = await classify()
      if (outcome.status === 'succeeded') {
        // Greenhouse may briefly paint its loading shell during the receipt transition.
        // Capture the settled receipt, and recheck rather than retaining stale success text.
        await tab.waitForTimeout(800)
        outcome = await classify()
      }
      const opaqueVisible = !!state.opaqueChallengeSeen && !!state.opaqueChallengeBaseline && await newProviderChallenge(tab, state.opaqueChallengeBaseline)
      const challengeVisible = opaqueVisible || await visibleCaptchaChallenge(tab)
      if (challengeVisible) state.challengeSeen = true
      if (outcome.status === 'unknown' && challengeVisible) outcome = {
        status: 'blocked', reason: 'captcha_required', detail: 'A visible CAPTCHA challenge is waiting in the preserved tab. Continue verification before any further Submit click.'
      }
      if (state.applicationRequestFailed && outcome.status !== 'succeeded') outcome = { status: 'unknown', reason: 'unknown_outcome', detail: 'An application request failed after it was sent; receipt is unknown. Do not submit again.' }
      if (state.trace) {
        record('observation_complete', { requests: state.trace.requests, finished: state.trace.finished, failed: state.trace.failedRequests, outcome: outcome.status })
        await state.trace.pending
        if (state.trace.failed && outcome.status !== 'succeeded') outcome = { status: 'unknown', reason: 'unknown_outcome', detail: 'Application request trace failed; receipt is unknown. Do not submit again.' }
      }
      await mkdir(resolve(options.evidenceRoot), { recursive: true })
      const screenshot = join(resolve(options.evidenceRoot), `${position.id}-${Date.now()}.png`)
      await tab.bringToFront().catch(() => {})
      const captured = await tab.screenshot({ path: screenshot, fullPage: !challengeVisible, timeout: 5000 }).then(() => true, () => false)
      outcome.evidence = { url: safeApplicationEvidenceUrl(tab.url()), observedAt: new Date().toISOString(), screenshot: captured ? screenshot : undefined, message: outcome.detail, ...(outcome.status === 'succeeded' ? { confirmation: 'captured' as const } : {}), responses: [...new Set(responses)] }
      return outcome
    }
    return {
      inspect: async () => {
        let form = name === 'gurtam' ? await inspectGurtam(tab) : await inspectForm(tab)
        if (name === 'bamboohr' && !form.fields.some(field => /^(first name|last name|email|resume\/?cv)\b/i.test(field.label))) {
          const apply = tab.getByRole('button', { name: /^apply for this job$/i })
          if (await apply.isVisible().catch(() => false)) {
            await apply.click()
            await tab.locator('#firstName').waitFor({ state: 'visible', timeout: 15_000 })
            form = await inspectForm(tab)
          }
        }
        if (!form.fields.length && !form.closed) {
          const apply = tab.getByRole('button', { name: /^apply( now| for this job)?$/i }).first()
          if (await apply.isVisible().catch(() => false)) { await apply.click(); await tab.waitForTimeout(700); form = await inspectForm(tab) }
        }
        form.url = safeApplicationEvidenceUrl(form.url)
        const gate = classifyOutcome({ text: form.text, url: form.url, responses })
        if (gate.reason && ['captcha_required', 'robot_rejected', 'email_verification_required'].includes(gate.reason)) return { ...form, gate: gate.reason }
        if (gate.status !== 'succeeded' && await visibleCaptchaChallenge(tab)) { state.challengeSeen = true; return { ...form, gate: 'captcha_required' } }
        if (!form.fields.length && !form.closed && !/thank you for applying|application.*successfully submitted/i.test(form.text)) throw Error('No supported application fields found')
        if (name === 'bamboohr' && !form.fields.some(field => /^(first name|last name|email|resume\/?cv)\b/i.test(field.label))) throw Error('No BambooHR application fields found')
        return form
      },
      fill: async (candidate, answers) => {
        const hash = createHash('sha256').update(await readFile(candidate.cv.path)).digest('hex')
        if (hash !== candidate.cv.sha256) throw Error('CV changed since intake')
        state.saveFailed = false
        state.uploadedResume = undefined
        state.uploadVerifiedKeys = []
        if (name === 'gurtam') await fillGurtam(tab, candidate, answers, synchronize)
        else {
          const keys = await fillFields(tab, candidate, answers, synchronize)
          if (keys.length) state.uploadedResume = { keys, fileName: candidate.cv.fileName, sha256: candidate.cv.sha256 }
        }
      },
      verify: async (candidate, answers) => {
        await synchronize()
        if (name === 'gurtam') return verifyGurtam(tab, candidate, answers)
        const errors = await verifyFields(tab, candidate, answers)
        const upload = state.uploadedResume
        if (upload && upload.sha256 === candidate.cv.sha256 && upload.fileName === candidate.cv.fileName) {
          const current = await inspectForm(tab)
          if (upload.keys.some(key => !current.fields.some(field => field.key === key)) && !await tab.getByText(candidate.cv.fileName, { exact: false }).first().isVisible().catch(() => false)) errors.push('Uploaded resume filename is not acknowledged by the form')
        } else if (upload) errors.push('Uploaded resume differs from selected CV')
        state.uploadVerifiedKeys = !errors.length && upload ? [...upload.keys] : []
        return errors
      },
      verifiedUploadKeys: () => state.uploadVerifiedKeys ?? [],
      submit: async () => {
        responses.length = 0
        await startTrace()
        const submit = (name === 'gurtam' ? tab.locator('#recruitment-applications-form') : tab).getByRole('button', { name: /^(submit application|send application|submit your application|apply|apply now)$/i }).last()
        const providerBefore = await providerFrameBaseline(tab)
        state.opaqueChallengeSeen = false
        state.opaqueChallengeBaseline = providerBefore
        state.submitClicked = true
        await submit.click({ timeout: 15_000 })
        const until = Date.now() + (options.outcomeTimeoutMs ?? 15_000)
        while (Date.now() < until) {
          await tab.waitForTimeout(150); await Promise.all([...pending])
          const result = classifyOutcome({ text: await tab.locator('body').innerText(), url: tab.url(), responses })
          if (result.status !== 'unknown' || await visibleCaptchaChallenge(tab)) break
          if (await newProviderChallenge(tab, providerBefore)) { state.opaqueChallengeSeen = true; break }
        }
        return observe()
      },
      reconcile: () => observe(),
      continueAfterCaptcha: async (beforeSubmit: () => Promise<boolean>) => {
        const observed = await observe()
        if (observed.status === 'succeeded' || observed.reason === 'robot_rejected' || state.applicationRequests || state.applicationRequestFailed) return observed
        const challengeVisible = await visibleCaptchaChallenge(tab)
        const ready = await captchaVerificationComplete(tab)
        if (!mayContinueAfterCaptcha(state, ready, challengeVisible)) return observed
        const submit = (name === 'gurtam' ? tab.locator('#recruitment-applications-form') : tab).getByRole('button', { name: /^(submit application|send application|submit your application|apply|apply now)$/i }).last()
        if (!await submit.isVisible().catch(() => false) || !await submit.isEnabled().catch(() => false)) return observed
        if (!await beforeSubmit()) return { status: 'unknown', reason: 'unknown_outcome', detail: 'Continuation safety checks did not pass. Preserve this attempt for reconciliation; no new submission.', evidence: observed.evidence }
        // Give auto-submission a short window, then recheck after durable same-attempt intent.
        await tab.waitForTimeout(750)
        await Promise.all([...pending])
        if (classifyObservedOutcome(await tab.locator('body').innerText(), tab.url(), responses).status === 'succeeded') return observe()
        if (!mayContinueAfterCaptcha(state, await captchaVerificationComplete(tab), await visibleCaptchaChallenge(tab)) || !await submit.isEnabled().catch(() => false)) return observe()
        state.continuationClicked = true
        record('same_attempt_continuation')
        const providerBefore = await providerFrameBaseline(tab)
        state.opaqueChallengeSeen = false
        state.opaqueChallengeBaseline = providerBefore
        await submit.click({ timeout: 15_000 })
        const until = Date.now() + (options.outcomeTimeoutMs ?? 15_000)
        while (Date.now() < until) {
          await tab.waitForTimeout(500)
          await Promise.all([...pending])
          const current = classifyObservedOutcome(await tab.locator('body').innerText(), tab.url(), responses)
          if (current.status !== 'unknown' || await visibleCaptchaChallenge(tab)) break
          if (await newProviderChallenge(tab, providerBefore)) { state.opaqueChallengeSeen = true; break }
        }
        return observe()
      },
      close: async () => { detachHandlers.get(tab)?.(); detachHandlers.delete(tab); await tab.close() }
    }
  } }))
}
