import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchFixtureBrowser } from './browser-driver.ts'
import { createAtsAdapters, observedSumupApplicationUrl } from '../applications/ats-forms.ts'
import { verifiedUploadOnlyDrift } from '../applications/form-fields.ts'
import { currentSumupPostingUrl } from '../applications/engines/sumup.ts'
import { decisionRulesHash, loadSelectionRules } from '../stack_classification/rules.ts'
import type { Candidate, Position } from '../types.ts'

const sumup = 'https://www.sumup.com/careers/positions/warsaw-poland/engineering/senior-backend-engineer-bookings/8508079002/'
const greenhouse = 'https://job-boards.greenhouse.io/embed/job_app?for=sumup&validityToken=private-fixture&token=8508079002'
const gurtam = 'https://gurtam.com/career/python-developer-lt'
function position(url: string): Position {
  return { id: 'fixture', company: 'Fixture', title: 'Developer', url, applyUrl: url, location: '', description: '', retrievedAt: '', source: { name: 'fixture', url } }
}

test('SumUp accepts only the observed matching Greenhouse application frame', () => {
  assert.equal(observedSumupApplicationUrl(sumup, [greenhouse]), greenhouse)
  assert.equal(observedSumupApplicationUrl('https://sumup.com/careers/positions/8508079002?gh_jid=8508079002', [greenhouse]), greenhouse)
  assert.throws(() => observedSumupApplicationUrl('https://sumup.com/careers/positions/8508079002?gh_jid=123', [greenhouse]))
  for (const frames of [[], [greenhouse, greenhouse], [greenhouse.replace('8508079002', '123')], [greenhouse.replace('job-boards.greenhouse.io', 'evil.example')], ['javascript:alert(1)']]) {
    assert.throws(() => observedSumupApplicationUrl(sumup, frames))
  }
})

test('SumUp resolves the current official route only for the frozen job ID', async () => {
  const old = sumup
  const current = 'https://sumup.com/careers/positions/8508079002?gh_jid=8508079002'
  const read = async (url: string) => {
    assert.equal(url, 'https://boards-api.greenhouse.io/v1/boards/sumup/jobs/8508079002?content=true')
    return { status: 200, body: { id: 8508079002, absolute_url: current } }
  }
  assert.equal(await currentSumupPostingUrl(old, read), current)
  await assert.rejects(currentSumupPostingUrl(old, async () => ({ status: 404, body: undefined })))
  await assert.rejects(currentSumupPostingUrl(old, async () => ({ status: 200, body: { id: 123, absolute_url: current } })))
  await assert.rejects(currentSumupPostingUrl(old, async () => ({ status: 200, body: { id: 8508079002, absolute_url: 'https://evil.example/careers/positions/8508079002' } })))
})

test('SumUp checks the current official first publication before opening a form', async () => {
  const published = new Date(Date.now() - 17 * 86400000).toISOString()
  const selectionRules = await loadSelectionRules()
  const adapter = createAtsAdapters({ context: {} as never, evidenceRoot: tmpdir(), selectionRules, stackId: '7',
    sumupReviews: { fixture: { externalId: '8508079002', source: sumup, title: 'Developer', descriptionSha256: createHash('sha256').update('').digest('hex'), rulesHash: decisionRulesHash(selectionRules), publishedAt: published, decision: 'excluded', stackIds: [] } },
    readSumupJob: async () => ({ status: 200, body: { id: 8508079002, absolute_url: sumup, title: 'Developer', content: '', first_published: published } }) }).find(item => item.name === 'sumup')!
  await assert.rejects(adapter.open(position(sumup)), /posting_expired/)
})

test('SumUp stops when the reviewed current description changes', async () => {
  const published = new Date(Date.now() - 14 * 86400000).toISOString()
  const selectionRules = await loadSelectionRules()
  const adapter = createAtsAdapters({ context: {} as never, evidenceRoot: tmpdir(), selectionRules, stackId: '7',
    sumupReviews: { fixture: { externalId: '8508079002', source: sumup, title: 'Developer', descriptionSha256: createHash('sha256').update('Reviewed').digest('hex'), rulesHash: decisionRulesHash(selectionRules), publishedAt: published, decision: 'eligible', stackIds: ['7'] } },
    readSumupJob: async () => ({ status: 200, body: { id: 8508079002, absolute_url: sumup, title: 'Developer', content: 'Changed', first_published: published } }) }).find(item => item.name === 'sumup')!
  await assert.rejects(adapter.open(position(sumup)), /posting_content_review_required/)
})

test('Only a verified uploaded resume may disappear from the question list', () => {
  const before = [{ key: 'id:name', label: 'Name', type: 'text', required: true, options: [] }, { key: 'id:resume', label: 'Resume/CV', type: 'file', required: true, options: [] }]
  assert.equal(verifiedUploadOnlyDrift(before, before.slice(0, 1), ['id:resume']), true)
  assert.equal(verifiedUploadOnlyDrift(before, before.slice(0, 1), []), false)
  assert.equal(verifiedUploadOnlyDrift(before, [...before.slice(0, 1), { key: 'id:new', label: 'New question', type: 'text', required: true, options: [] }], ['id:resume']), false)
  assert.equal(verifiedUploadOnlyDrift(before, [{ ...before[0], label: 'Changed' }], ['id:resume']), false)
})

test('SumUp verifies the displayed filename after its upload input disappears', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  const root = await mkdtemp(join(tmpdir(), 'sumup-upload-'))
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith(sumup)) return route.fulfill({ contentType: 'text/html', body: `<iframe src="${greenhouse}"></iframe>` })
      if (url.startsWith('https://job-boards.greenhouse.io/embed/job_app')) return route.fulfill({ contentType: 'text/html', body: `<form><label for="name">Name*</label><input id="name" required><label for="resume">Resume/CV*</label><input id="resume" type="file" required><script>document.querySelector('#resume').onchange=e=>{const chip=document.createElement('span');chip.textContent=e.target.files[0].name;e.target.replaceWith(chip)}</script></form>` })
      return route.abort()
    })
    const bytes = Buffer.from('%PDF-1.4 fixture resume'), path = join(root, 'cv.pdf')
    await writeFile(path, bytes)
    const candidate: Candidate = { id: 'fixture', facts: {}, criteria: { titles: [] }, createdAt: '', history: [], cv: { path, fileName: 'cv.pdf', sha256: createHash('sha256').update(bytes).digest('hex') } }
    const adapter = createAtsAdapters({ context, evidenceRoot: root, readSumupJob: async () => ({ status: 200, body: { id: 8508079002, absolute_url: sumup } }) }).find(item => item.name === 'sumup')!
    const session = await adapter.open(position(sumup))
    const before = (await session.inspect()).fields
    const answers = { values: { 'id:name': { value: 'Ada', evidence: ['fixture'] } }, missing: [] }
    await session.fill(candidate, answers)
    assert.deepEqual(await session.verify(candidate, answers), [])
    const after = (await session.inspect()).fields
    assert.equal(verifiedUploadOnlyDrift(before, after, session.verifiedUploadKeys?.() ?? []), true)
    await session.close(); await context.close()
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }) }
})

test('SumUp waits for its observed iframe to hydrate before opening it', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  const root = await mkdtemp(join(tmpdir(), 'sumup-hydrate-'))
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith(sumup)) return route.fulfill({ contentType: 'text/html', body: `<script>setTimeout(()=>{const frame=document.createElement('iframe');frame.src=${JSON.stringify(greenhouse)};document.body.append(frame)},1800)</script>` })
      if (url.startsWith('https://job-boards.greenhouse.io/embed/job_app')) return route.fulfill({ contentType: 'text/html', body: '<form><label for="name">Name*</label><input id="name" required></form>' })
      return route.abort()
    })
    const adapter = createAtsAdapters({ context, evidenceRoot: root, readSumupJob: async () => ({ status: 200, body: { id: 8508079002, absolute_url: sumup } }) }).find(item => item.name === 'sumup')!
    const session = await adapter.open(position(sumup))
    assert.deepEqual((await session.inspect()).fields.map(field => field.label), ['Name*'])
    await session.close(); await context.close()
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }) }
})

test('SumUp follows observed frame and strips its ephemeral token from receipt evidence', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  const root = await mkdtemp(join(tmpdir(), 'sumup-form-'))
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith(sumup)) return route.fulfill({ contentType: 'text/html', body: `<iframe src="${greenhouse}"></iframe><form><input aria-label="newsletter"></form>` })
      if (url.startsWith('https://job-boards.greenhouse.io/embed/job_app')) return route.fulfill({ contentType: 'text/html', body: '<form><label for="name">Name*</label><input id="name" required><button onclick="event.preventDefault();location.href=\'/thanks\'">Submit application</button></form>' })
      if (url === 'https://job-boards.greenhouse.io/thanks') return route.fulfill({ contentType: 'text/html', body: '<h1>Thank you for applying</h1>' })
      return route.abort()
    })
    const adapter = createAtsAdapters({ context, evidenceRoot: root, readSumupJob: async () => ({ status: 200, body: { id: 8508079002, absolute_url: sumup } }) }).find(item => item.name === 'sumup')!
    const session = await adapter.open(position(sumup))
    const form = await session.inspect()
    assert.deepEqual(form.fields.map(field => field.label), ['Name*'])
    assert.ok(!form.url.includes('validityToken'))
    const outcome = await session.reconcile()
    assert.equal(outcome.status, 'unknown')
    assert.ok(!outcome.evidence?.url?.includes('validityToken'))
    const resumed = await adapter.open(position(sumup))
    assert.equal(context.pages().length, 1)
    const receipt = await resumed.submit()
    assert.equal(receipt.status, 'succeeded')
    assert.equal(receipt.evidence?.url, 'https://job-boards.greenhouse.io/thanks')
    await resumed.close()
    await context.close()
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }) }
})

test('Gurtam scopes the native form, clicks visible selectors, verifies file and consent, and requires a visible receipt', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  const root = await mkdtemp(join(tmpdir(), 'gurtam-form-'))
  try {
    const context = await browser.newContext()
    let posts = 0, rejectApplication = false, drift = false, hiddenOption = true
    const html = `<style>.checkbox-input{display:inline-block;width:12px;height:12px}</style><input aria-label="newsletter" required><section class="recruitment-applications"><form id="recruitment-applications-form">
      <input name="role" value="Developer"><label for="first_name">First name*</label><input id="first_name" data-js="required">
      <label for="last_name">Last name*</label><input id="last_name" data-js="required"><label for="email">Email*</label><input id="email" type="email" data-js="required">
      <div class="form-field"><label class="form-label">Country*</label><div class="select"><div class="dropdown-button"><input class="select-input" readonly><input id="country" class="select-input-hidden" hidden data-js="required"></div><span class="select-option" data-value="Georgia">Georgia</span></div></div>
      <label for="button-upload">Attach file</label><input id="button-upload" type="file" hidden><span id="button-upload-label"></span><input id="cv" hidden>
      <label class="checkbox">Privacy*<input id="employment-candidate-privacy-policy" type="checkbox" style="display:none" data-js="required"><span class="checkbox-input"></span></label><label class="checkbox">Future consent*<input id="consent" type="checkbox" style="display:none" data-js="required"><span class="checkbox-input"></span></label>
      <button type="submit">Submit application</button></form><div class="recruitment-applications-form-confirmation" hidden>Your application has been submitted successfully.</div></section>
      <script>document.querySelector('.select-option').onclick=e=>{document.querySelector('#country').value=e.target.dataset.value;document.querySelector('.select-input').value=e.target.textContent};document.querySelector('#button-upload').onchange=e=>{document.querySelector('#cv').value=e.target.files[0].name;document.querySelector('#button-upload-label').textContent=e.target.files[0].name};document.querySelectorAll('.checkbox').forEach(e=>{const input=e.querySelector('input');e.addEventListener('click',event=>{if(event.target.tagName.toLowerCase()!=='a') input.checked=!input.checked})});document.querySelector('form').onsubmit=async e=>{e.preventDefault();await fetch('/recruitment-application-form',{method:'POST'});document.querySelector('.recruitment-applications').classList.add('form-submitted');document.querySelector('.recruitment-applications-form-confirmation').hidden=false}</script>`
    await context.route('**/*', route => {
      if (route.request().method() === 'POST') { posts++; return route.fulfill({ status: 200, contentType: 'application/json', body: rejectApplication ? '{"validationErrors":{"email":"invalid"}}' : '{}' }) }
      const rendered = hiddenOption ? html.replace('data-value="Georgia"', 'style="display:none" data-value="Georgia"') : html
      return route.fulfill({ contentType: 'text/html', body: drift ? rendered.replace('</form>', '<label for="new_question">New question*</label><input id="new_question" data-js="required"></form>') : rendered })
    })
    const bytes = Buffer.from('%PDF-1.4 fixture'), path = join(root, 'cv.pdf')
    await writeFile(path, bytes)
    const candidate: Candidate = { id: 'fixture', facts: {}, criteria: { titles: [] }, createdAt: '', history: [], cv: { path, fileName: 'cv.pdf', sha256: createHash('sha256').update(bytes).digest('hex') } }
    const adapter = createAtsAdapters({ context, evidenceRoot: root, outcomeTimeoutMs: 1000 }).find(item => item.name === 'gurtam')!
    const session = await adapter.open(position(gurtam))
    const fields = (await session.inspect()).fields
    assert.ok(fields.some(field => field.label === 'Country*' && field.type === 'gurtam-select'))
    assert.ok(!fields.some(field => /newsletter|role/i.test(field.label)))
    assert.equal((await session.reconcile()).status, 'unknown')
    assert.equal(posts, 0)
    const answers = { values: Object.fromEntries([['first_name', 'Ada'], ['last_name', 'Lovelace'], ['email', 'ada@example.org'], ['country', 'Georgia'], ['employment-candidate-privacy-policy', 'true'], ['consent', 'true']].map(([id, value]) => [`id:${id}`, { value, evidence: ['fixture'] }])), missing: [] }
    await session.fill(candidate, answers)
    assert.deepEqual(await session.verify(candidate, answers), [])
    assert.equal(posts, 0)
    const outcome = await session.submit()
    assert.equal(outcome.status, 'succeeded')
    assert.equal(posts, 1)
    await session.close()
    hiddenOption = false
    rejectApplication = true
    const rejected = await adapter.open({ ...position(gurtam), id: 'rejected' })
    await rejected.fill(candidate, answers)
    assert.deepEqual(await rejected.verify(candidate, answers), [])
    const error = await rejected.submit()
    assert.equal(error.status, 'failed')
    assert.equal(error.reason, 'validation_error')
    assert.equal(posts, 2)
    await rejected.close()
    drift = true
    const changed = await adapter.open({ ...position(gurtam), id: 'changed' })
    await assert.rejects(changed.inspect(), /Unknown required Gurtam application control/)
    assert.equal(posts, 2)
    await changed.close()
    await context.close()
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }) }
})
