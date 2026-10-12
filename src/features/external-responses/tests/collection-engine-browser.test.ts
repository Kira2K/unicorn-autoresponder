import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { Route } from 'playwright'
import { createPageReader } from '../vacancy_collection/page-reader.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import type { ExtractionSelectors } from '../vacancy_collection/source-memory.ts'

const require = createRequire(import.meta.url)
const patchright = require('patchright') as typeof import('playwright')

test('custom extraction controls reveal jobs but cannot activate application controls', async () => {
  const browser = await patchright.chromium.launch({ headless: true, channel: 'chromium' })
  try {
    const context = await browser.newContext()
    await context.route('**/*', (route: Route) => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><body>
        <h1>Careers</h1>
        <button id="engineering-tab" onclick="document.querySelector('#engineering').hidden=false">Engineering roles</button>
        <section id="engineering" hidden>
          <article class="job-card">
            <a class="job-link" href="/jobs/backend-1">View role</a>
            <h2 class="job-title">Senior Backend Engineer</h2>
            <span class="job-location">Remote Europe</span>
            <div class="job-description">Responsibilities: design and build reliable production backend services for customers. Requirements: professional software engineering experience, API design and ownership of delivered features.</div>
          </article>
        </section>
        <a id="apply-now" href="/apply/backend-1">Apply now</a>
        <button id="register">Register to apply</button>
        <form action="/submit"><button id="submit" type="submit">Continue</button></form>
        <script>fetch('/api/jobs?keyword=backend&access_token=fixture-secret&cf_chl_tk=challenge&csrf_nonce=hidden&captcha-response=hidden&utm_source=test')</script>
      </body></html>`
    }))
    const reader = createPageReader({ context, minIntervalMs: 0 })
    const extraction: ExtractionSelectors = {
      listingSelector: '.job-card',
      detailLinkSelector: '.job-link',
      titleSelector: '.job-title',
      locationSelector: '.job-location',
      descriptionSelector: '.job-description'
    }
    const page = await reader.read('https://engine-fixture.test/careers', {
      steps: [{ operation: 'click', selector: '#engineering-tab', name: 'Show jobs' }],
      extraction
    })
    assert.equal(page.jobs.length, 1)
    assert.equal(page.jobs[0].title, 'Senior Backend Engineer')
    assert.equal(page.jobs[0].location, 'Remote Europe')
    assert.equal(page.jobs[0].url, 'https://engine-fixture.test/jobs/backend-1')
    assert.match(page.jobs[0].description, /reliable production backend services/)
    assert.deepEqual(page.controls, [{ operation: 'click', selector: '#engineering-tab', name: 'Show jobs' }])
    assert.ok(page.diagnostics?.cards.some(card => card.href === 'https://engine-fixture.test/jobs/backend-1' && card.className === 'job-link'))
    assert.ok(page.diagnostics?.controls.some(control => control.id === 'engineering-tab'))
    assert.deepEqual(page.diagnostics?.listingRequests.filter(request => request.url.includes('/api/jobs')), [{ url: 'https://engine-fixture.test/api/jobs?keyword=backend', method: 'GET', resourceType: 'fetch' }])

    for (const selector of ['#apply-now', '#register', '#submit']) {
      await assert.rejects(
        reader.read('https://engine-fixture.test/careers', { steps: [{ operation: 'click', selector, name: 'Show jobs' }], extraction }),
        /recipe_control_not_allowed/
      )
    }
  } finally { await browser.close() }
})

test('custom pagination collects every listing page without unrelated navigation', async () => {
  const browser = await patchright.chromium.launch({ headless: true, channel: 'chromium' })
  try {
    const context = await browser.newContext(), visited: string[] = []
    await context.route('**/*', (route: Route) => {
      const requestUrl = new URL(route.request().url())
      visited.push(requestUrl.pathname + requestUrl.search)
      const title = requestUrl.pathname.endsWith('/backend-1') ? 'Senior Python Engineer' : 'Senior Go Engineer'
      const body = requestUrl.pathname.startsWith('/jobs/')
        ? `<main><h1>${title}</h1><h2>Responsibilities</h2><p>Build reliable production backend services and APIs for customers. Own delivery, testing, observability and maintenance with the engineering team.</p><button>Apply now</button></main>`
        : requestUrl.searchParams.get('page') === '2'
          ? `<main><article class="job-card"><a class="job-link" href="/jobs/backend-2">Senior Go Engineer</a><h2 class="job-title">Senior Go Engineer</h2><div class="job-description">Responsibilities: build reliable Go backend services and production APIs. Requirements: professional software engineering and product delivery experience.</div></article></main><a href="/culture">Culture</a>`
          : `<main><article class="job-card"><a class="job-link" href="/jobs/backend-1">Senior Python Engineer</a><h2 class="job-title">Senior Python Engineer</h2><div class="job-description">Responsibilities: build reliable Python backend services and production APIs. Requirements: professional software engineering and product delivery experience.</div></article></main><a class="pager-next" href="/careers?page=2">Next</a><a href="/culture">Culture</a><a href="/apply/backend-1">Apply now</a>`
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body })
    })
    const extraction: ExtractionSelectors = {
      listingSelector: '.job-card',
      detailLinkSelector: '.job-link',
      titleSelector: '.job-title',
      descriptionSelector: '.job-description',
      paginationSelector: '.pager-next'
    }
    const baseReader = createPageReader({ context, minIntervalMs: 0 })
    const reader = { read: (url: string, options = {}) => baseReader.read(url, { ...options, extraction }) }
    const source = { name: 'Pagination fixture', url: 'https://pagination-fixture.test/careers?page=1' }
    const result = await createWebsiteStrategy({ reader, maxPages: 6, concurrency: 1 }).discover([source])

    assert.deepEqual(result.positions.map(position => position.title).sort(), ['Senior Go Engineer', 'Senior Python Engineer'])
    assert.equal(result.audit[0].status, 'complete')
    assert.ok(visited.includes('/careers?page=1'))
    assert.ok(visited.includes('/careers?page=2'))
    assert.ok(visited.includes('/jobs/backend-1'))
    assert.ok(visited.includes('/jobs/backend-2'))
    assert.ok(!visited.some(path => path.startsWith('/culture') || path.startsWith('/apply')))
  } finally { await browser.close() }
})

test('empty job search on a detail page is not submitted back to the listing', async () => {
  const browser = await patchright.chromium.launch({ headless: true, channel: 'chromium' })
  try {
    const context = await browser.newContext(), actions: string[] = []
    await context.route('**/*', (route: Route) => {
      const path = new URL(route.request().url()).pathname
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: path === '/careers'
        ? '<h1>Careers listing reached incorrectly</h1><p>No open jobs</p>'
        : `<input placeholder="Search jobs" value="" onkeydown="if(event.key==='Enter') location.href='/careers'">
           <main><h1>Senior Java Engineer</h1><h2>Responsibilities</h2><p>Build reliable Java backend services and production APIs for customers. Requirements include professional Spring engineering and ownership of delivered features.</p><button>Apply now</button></main>` })
    })
    const detail = 'https://empty-search.test/jobs/java-1'
    const page = await createPageReader({ context, minIntervalMs: 0 }).read(detail, { onAction: async action => { actions.push(action.operation) } })
    assert.equal(page.url, detail)
    assert.equal(page.jobs[0].title, 'Senior Java Engineer')
    assert.ok(!actions.includes('clear_search'))
  } finally { await browser.close() }
})

test('custom empty state requires visible explicit no-jobs text', async () => {
  const browser = await patchright.chromium.launch({ headless: true, channel: 'chromium' })
  try {
    const context = await browser.newContext()
    await context.route('**/*', (route: Route) => {
      const path = new URL(route.request().url()).pathname
      const empty = path === '/empty' ? 'No open jobs found' : path === '/hidden' ? 'No open jobs found' : 'Vacancies appear here'
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<h1>Careers</h1><p class="empty" ${path === '/hidden' ? 'hidden' : ''}>${empty}</p>` })
    })
    const reader = createPageReader({ context, minIntervalMs: 0 })
    const extraction: ExtractionSelectors = { emptyStateSelector: '.empty' }
    assert.equal((await reader.read('https://empty-state.test/empty', { extraction })).explicitlyEmpty, true)
    assert.equal((await reader.read('https://empty-state.test/hidden', { extraction })).explicitlyEmpty, false)
    assert.equal((await reader.read('https://empty-state.test/placeholder', { extraction })).explicitlyEmpty, false)
  } finally { await browser.close() }
})

test('fill_search is limited to public job search inputs', async () => {
  const browser = await patchright.chromium.launch({ headless: true, channel: 'chromium' })
  try {
    const context = await browser.newContext()
    await context.route('**/*', (route: Route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <form action="/jobs/search"><input id="positions-search" aria-label="Search roles"><button>Find jobs</button></form>
      <form action="/apply"><input id="application-keyword" name="job keyword"><input type="file"><button>Apply now</button></form>
      <input id="location-search" aria-label="Search location">
      <script>document.querySelector('#positions-search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); document.body.dataset.query = event.target.value } })</script>
    ` }))
    const reader = createPageReader({ context, minIntervalMs: 0 })
    const page = await reader.read('https://search-control.test/jobs', { steps: [{ operation: 'fill_search', selector: '#positions-search', value: 'engineer OR developer' }] })
    assert.deepEqual(page.controls, [{ operation: 'fill_search', selector: '#positions-search', value: 'engineer OR developer' }])
    await assert.rejects(reader.read('https://search-control.test/jobs', { steps: [{ operation: 'fill_search', selector: '#application-keyword', value: 'engineer' }] }), /recipe_search_fill_not_allowed/)
    await assert.rejects(reader.read('https://search-control.test/jobs', { steps: [{ operation: 'fill_search', selector: '#location-search', value: 'engineer' }] }), /recipe_search_fill_not_allowed/)
  } finally { await browser.close() }
})

test('detail extraction preserves public role prose wrapped by an application form', async () => {
  const browser = await patchright.chromium.launch({ headless: true, channel: 'chromium' })
  try {
    const context = await browser.newContext()
    await context.route('**/*', (route: Route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <main>
        <h1>Senior Python Engineer</h1>
        <script type="application/ld+json">${JSON.stringify({ '@type':'JobPosting', title:'Senior Python Engineer', description:'ABOUT THE COMPANY. As a fast-growing, award-winning company, we offer a vibrant work culture and opportunities for growth.', url:'https://form-wrapper.test/jobs/python-1' })}</script>
        <form action="/applications">
          <section><h2>Responsibilities</h2><p>Develop reliable Python backend services and own their production operation.</p><h2>Requirements</h2><p>Professional API and distributed-systems experience.</p></section>
          <label>Private email <input type="email" value="secret@example.test"></label>
          <input type="file" name="resume"><button type="submit">Submit application</button>
        </form>
      </main>` }))
    const page = await createPageReader({ context, minIntervalMs: 0 }).read('https://form-wrapper.test/jobs/python-1')
    assert.equal(page.jobs.length, 1)
    assert.match(page.jobs[0].description, /Develop reliable Python backend services/)
    assert.match(page.jobs[0].description, /Professional API and distributed-systems experience/)
    assert.doesNotMatch(page.jobs[0].description, /secret@example\.test|Submit application/)
  } finally { await browser.close() }
})
