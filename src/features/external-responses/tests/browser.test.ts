import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { launchFixtureBrowser } from './browser-driver.ts'
import type { Route } from 'playwright'
import { createAtsAdapters } from '../applications/ats-forms.ts'
import { createAnswerGenerator } from '../infrastructure/ai.ts'
import { positionId } from '../infrastructure/identity.ts'
import type { Candidate, Position } from '../types.ts'
import { inspectForm, fillFields, verifyFields } from '../applications/form-fields.ts'
import { createPageReader } from '../vacancy_collection/page-reader.ts'
import { createWebsiteStrategy } from '../vacancy_collection/discover.ts'
import { collectVacancies } from '../vacancy_collection/index.ts'

test('collection blocks excluded hosts through HTTP and script redirects before network delivery', async () => {
  let forbiddenRequests=0
  const server=createServer((request,response)=>{
    if(request.headers.host?.startsWith('127.0.0.1')){forbiddenRequests++;response.end('FORBIDDEN CONTENT');return}
    const target=`http://127.0.0.1:${(server.address() as any).port}/blocked`
    if(request.url==='/chain'){response.writeHead(302,{location:'/redirect'});response.end();return}
    if(request.url==='/allowed'){response.writeHead(302,{location:'/vacancy'});response.end();return}
    if(request.url==='/vacancy'){response.setHeader('Content-Type','text/html');response.end('<h1>Careers</h1><p>No open positions</p>');return}
    if(request.url==='/script'){response.setHeader('Content-Type','text/html');response.end(`<script>location.href=${JSON.stringify(target)}</script>`);return}
    response.writeHead(302,{location:target});response.end()
  })
  await new Promise<void>(resolve=>server.listen(0,'0.0.0.0',resolve))
  const browser=await launchFixtureBrowser({headless:true})
  try{
    const context=await browser.newContext()
    const reader=createPageReader({context,minIntervalMs:0,excludedHosts:['127.0.0.1']})
    for(const path of ['/redirect','/chain','/script'])await assert.rejects(reader.read(`http://localhost:${(server.address() as any).port}${path}`))
    const allowed=await reader.read(`http://localhost:${(server.address() as any).port}/allowed`)
    assert.match(allowed.text,/No open positions/)
    assert.equal(forbiddenRequests,0)
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})

test('Notion linked role details preserve the description and source company', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const context=await browser.newContext(), url='https://company.notion.site/Careers-11111111111111111111111111111111'
    const detail='https://company.notion.site/Senior-Backend-Developer-22222222222222222222222222222222'
    await context.route('**/*',(route:Route)=>route.fulfill({contentType:'text/html',body:route.request().url()===url?`<h1>Careers</h1><a href="${detail}">Senior Backend Developer</a>`:'<main><h1>Senior Backend Developer</h1><p>Responsibilities: build Python APIs with FastAPI for our European product team. Own features and maintain production services.</p><p>Send your CV to join our engineering team.</p></main>'}))
    const result=await createWebsiteStrategy({reader:createPageReader({context,minIntervalMs:0}),maxPages:3,concurrency:1}).discover([{name:'Company',url}])
    assert.equal(result.positions.length,1); assert.equal(result.positions[0].company,'Company'); assert.equal(result.positions[0].url,detail); assert.match(result.positions[0].description,/Python APIs with FastAPI/)
  } finally {await browser.close()}
})

test('career cards with short URLs resolve to complete job descriptions',async()=>{
  const browser=await launchFixtureBrowser({headless:true,channel:'chromium'})
  try{
    const context=await browser.newContext()
    await context.route('**/*',(route:Route)=>route.fulfill({contentType:'text/html; charset=utf-8',body:new URL(route.request().url()).pathname==='/vacancies'?'<h1>Вакансии</h1><a href="/react">React-разработчик</a><a href="/blog/developer">Developer story</a>':'<h1>React-разработчик</h1><h2>Чем ты будешь заниматься</h2><p>Разработка пользовательских интерфейсов на React и TypeScript. Наши ожидания: опыт разработки, интеграции REST API и самостоятельная доставка функций.</p><button>Откликнуться</button><form><div>UNRELATED_FORM_CONFIGURATION</div></form>'}))
    const result=await createWebsiteStrategy({reader:createPageReader({context,minIntervalMs:0}),maxPages:3,concurrency:1}).discover([{name:'Fixture',url:'https://fixture.test/vacancies'}])
    assert.equal(result.positions.length,1);assert.equal(result.positions[0].url,'https://fixture.test/react');assert.match(result.positions[0].description,/TypeScript/);assert.doesNotMatch(result.positions[0].description,/UNRELATED_FORM_CONFIGURATION/);assert.equal(result.audit[0].status,'complete')
  }finally{await browser.close()}
})

test('collection leaves site-wide search untouched and only clears explicitly labelled job search', async () => {
  const browser=await launchFixtureBrowser({headless:true})
  try {
    const context=await browser.newContext(),actions:any[]=[]
    await context.route('**/*',(route:Route)=>route.fulfill({contentType:'text/html',body:route.request().url().endsWith('/empty')?'<h1>Careers</h1><input placeholder="Search jobs" onkeydown="document.body.innerHTML=\'UNNECESSARY_SEARCH\'"><p>No open jobs</p>':'<h1>Careers</h1><input type="search" aria-label="Search website" onkeydown="if(event.key===\'Enter\')document.body.innerHTML=\'WRONG_SITE_SEARCH\'"><input placeholder="Search jobs" value="Python" onkeydown="if(event.key===\'Enter\')document.querySelector(\'p\').textContent=\'No open jobs\'"><p>Filter selected</p>'}))
    const page=await createPageReader({context,minIntervalMs:0}).read('https://fixture.test/careers',{onAction:async a=>{actions.push(a)}})
    assert.match(page.text,/No open jobs/);assert.doesNotMatch(page.text,/WRONG_SITE_SEARCH/);assert.equal(actions.filter(a=>a.operation==='clear_search').length,1)
    actions.length=0
    const empty=await createPageReader({context,minIntervalMs:0}).read('https://fixture.test/empty',{onAction:async a=>{actions.push(a)}})
    assert.match(empty.text,/No open jobs/);assert.doesNotMatch(empty.text,/UNNECESSARY_SEARCH/);assert.equal(actions.filter(a=>a.operation==='clear_search').length,0)
  } finally {await browser.close()}
})

test('collection detects mandatory registration but leaves optional login on public jobs alone', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  const evidenceDirectory=await mkdtemp(join(tmpdir(),'collection-evidence-')),actions:any[]=[]
  try {
    const context = await browser.newContext()
    await context.route('**/*', (route: Route) => route.fulfill({ contentType: 'text/html', body: route.request().url().includes('/private')
      ? '<h1>Register to view jobs</h1><input type="password">'
      : '<h1>Jobs</h1><a href="/login">Log in</a><a href="/jobs/engineer">Senior Engineer</a>' }))
    const reader = createPageReader({ context, minIntervalMs: 0,evidenceDirectory })
    assert.equal((await reader.read('https://fixture.test/private',{onAction:async a=>{actions.push(a)}})).accessGate?.kind, 'registration_required')
    assert.ok((await stat(actions.find(a=>a.operation==='failure_screenshot').evidenceRef)).size>0)
    assert.equal((await reader.read('https://fixture.test/public')).accessGate, undefined)
  } finally { await browser.close();await rm(evidenceDirectory,{recursive:true,force:true}) }
})

test('collection extracts Telegram-only job instructions without opening Telegram or a web form', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const context = await browser.newContext(), visited: string[] = []
    await context.route('**/*', (route: Route) => {
      visited.push(route.request().url())
      return route.fulfill({ contentType: 'text/html', body: '<main><h1>Senior Java Engineer</h1><p>Build Java Spring backend services.</p><p>Send CV in Telegram to <a href="https://t.me/hiring_team">our recruiter</a>.</p></main><footer><a href="https://t.me/community">Follow us</a></footer>' })
    })
    const source = { name: 'Example', url: 'https://fixture.test/jobs/java' }
    const result = await collectVacancies({ runId: 'tg-browser', sources: [source] }, { strategy: createWebsiteStrategy({ reader: createPageReader({ context, minIntervalMs: 0 }) }) })
    assert.equal(result.positions.length, 1)
    assert.deepEqual(result.positions[0].applicationDestinations?.map(route => route.address), ['https://t.me/hiring_team'])
    assert.ok(visited.every(url => new URL(url).hostname === 'fixture.test'))
  } finally { await browser.close() }
})

test('Lever structured location selects the matching suggestion and verifies its hidden saved value', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<li class="application-question"><label><div class="application-label">Current location</div><div><input id="location-input" name="location"><input id="selected-location" type="hidden" name="selectedLocation"><div class="dropdown-results"></div><span hidden>No location found</span></div></label></li><script>
      const input=document.getElementById('location-input'), saved=document.getElementById('selected-location'), results=document.querySelector('.dropdown-results');
      input.onkeydown=()=>setTimeout(()=>{saved.value=''; results.innerHTML='<div>Barcelona, Catalonia, Spain</div><div>Barcelona, Anzoategui, Venezuela</div>'; for(const el of results.children)el.onclick=()=>{input.value=el.textContent;saved.value=JSON.stringify({name:el.textContent});results.innerHTML=''};},20);
    </script>`)
    const candidate: any = { facts: { city: { value: 'Barcelona' }, country: { value: 'Spain' } } }
    const answers = { values: { 'id:location-input': { value: 'Barcelona, Spain', evidence: ['confirmed'] } }, missing: [] }
    const form = await inspectForm(page); assert.equal(form.fields[0].label, 'Current location'); assert.equal(form.fields[0].type, 'lever-location')
    await fillFields(page, candidate, answers, async () => {})
    assert.equal(JSON.parse(await page.locator('#selected-location').inputValue()).name, 'Barcelona, Catalonia, Spain')
    assert.deepEqual(await verifyFields(page, candidate, answers), [])
    await page.locator('#selected-location').evaluate((e: HTMLInputElement) => { e.value = '' })
    assert.match((await verifyFields(page, candidate, answers)).join(' '), /Location not saved/)
    await page.locator('#location-input').evaluate((input: HTMLInputElement) => {
      input.onkeydown = () => setTimeout(() => {
        const results = document.querySelector('.dropdown-results')!, saved = document.querySelector<HTMLInputElement>('#selected-location')!
        saved.value = ''; results.innerHTML = '<div>tbilisi, GEO</div><div>Tbilisi, GEO</div><div>Tbilisi, USA</div>'
        for (const option of results.children) (option as HTMLElement).onclick = () => {
          input.value = option.textContent!; saved.value = JSON.stringify({ name: option.textContent }); results.innerHTML = ''
        }
      }, 20)
    })
    candidate.facts = { city: { value: 'Tbilisi' }, country: { value: 'Georgia' } }
    answers.values['id:location-input'].value = 'Tbilisi, GEO'
    await fillFields(page, candidate, answers, async () => {})
    assert.equal(JSON.parse(await page.locator('#selected-location').inputValue()).name, 'Tbilisi, GEO')
    assert.deepEqual(await verifyFields(page, candidate, answers), [])
    answers.values['id:location-input'].value = 'TBILISI, GEO'
    await assert.rejects(fillFields(page, candidate, answers, async () => {}), /Ambiguous location/)
    await page.locator('#selected-location').evaluate((e: HTMLInputElement) => { e.value = '' })
    answers.values['id:location-input'].value = ''
    await fillFields(page, candidate, answers, async () => {})
    assert.equal(await page.locator('#location-input').inputValue(), '')
    assert.deepEqual(await verifyFields(page, candidate, answers), [])
    await page.locator('#location-input').evaluate((e: HTMLInputElement) => { e.required = true })
    assert.match((await verifyFields(page, candidate, answers)).join(' '), /Location not saved/)
  } finally { await browser.close() }
})

test('collection challenge detection requires a wall and removes cookie overlays from job text',async()=>{
  const browser=await launchFixtureBrowser({headless:true})
  try {
    const context=await browser.newContext()
    await context.route('**/*',(route:Route)=>{
      const path=new URL(route.request().url()).pathname
      const body=path==='/wall'?'<h1>Verify you are human</h1><p>Complete the security check.</p>':path==='/article'?'<h1>Protect users against social engineering</h1><p>Our product uses CAPTCHA and access denied responses.</p><a href="/careers">Careers</a>':path==='/careers'?'<script>const board="https://job-boards.greenhouse.io/fixture"</script><p>Join us</p>':'<main><h1>Senior Java Engineer</h1><p>Responsibilities: develop Java services and secure APIs for our customers. Work with a product team delivering complete features.</p><button>Apply now</button></main><div id="cookie-banner">COOKIE_NOISE: accept all cookies</div>'
      return route.fulfill({contentType:'text/html',body})
    })
    const reader=createPageReader({context,minIntervalMs:0})
    assert.equal((await reader.read('https://fixture.test/article')).accessGate,undefined)
    assert.equal((await reader.read('https://fixture.test/wall')).accessGate?.kind,'captcha_required')
    const embedded=await reader.read('https://fixture.test/careers')
    assert.equal(embedded.partial,false);assert.ok(embedded.links.some(l=>l.url.includes('greenhouse.io/fixture')))
    const detail=await reader.read('https://fixture.test/jobs/java')
    assert.doesNotMatch(detail.jobs[0].description,/COOKIE_NOISE/)
    assert.match(detail.jobs[0].description,/develop Java services/)
  }finally{await browser.close()}
})

test('collection follows real listings despite placeholder JSON-LD, including empty-label Workable links', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const context = await browser.newContext()
    await context.route('**/*', (route: Route) => route.fulfill({ contentType: 'text/html', body: new URL(route.request().url()).pathname === '/careers'
      ? '<script type="application/ld+json">[{"@type":"JobPosting","title":"Wrong stub","description":"~"}]</script><a href="/j/ABC123/"></a>'
      : '<main><div class="_banner__title_123">Senior Frontend Developer</div><p>We are looking for an engineer to build our JavaScript and TypeScript product interfaces with React and our design team.</p><button>Apply now</button></main>' }))
    const source = { name: 'Fixture', url: 'https://fixture.test/careers' }
    const result = await collectVacancies({ runId: 'listing-stubs', sources: [source] }, { strategy: createWebsiteStrategy({ reader: createPageReader({ context, minIntervalMs: 0 }) }) })
    assert.equal(result.positions.length, 1)
    assert.equal(result.positions[0].title, 'Senior Frontend Developer')
    assert.equal(result.audit[0].pages.length, 2)
  } finally { await browser.close() }
})

test('detail extraction replaces an action-label JSON-LD title with the visible job heading', async () => {
  const browser = await launchFixtureBrowser({ headless: true, channel: 'chrome' })
  try {
    const context = await browser.newContext()
    const url = 'https://fixture.test/careers/vacancy/machine-learning-engineer'
    await context.route('**/*', (route: Route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <div role="dialog"><h2>Cookie preferences</h2></div>
      <main>
        <h1>Machine Learning Engineer</h1>
        <script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Apply now', url, description: '<p>Responsibilities: build production machine learning services. Requirements: professional Python engineering and product delivery experience.</p>' })}</script>
        <h2>Responsibilities</h2><p>Build production machine learning services and own reliable delivery.</p>
        <button>Apply now</button>
      </main>` }))
    const page = await createPageReader({ context, minIntervalMs: 0 }).read(url)
    assert.equal(page.jobs.length, 1)
    assert.equal(page.jobs[0].title, 'Machine Learning Engineer')
  } finally { await browser.close() }
})

test('official Teamtailor boards are followed while LinkedIn remains excluded', async () => {
  const browser = await launchFixtureBrowser({ headless: true, channel: 'chrome' })
  try {
    const context = await browser.newContext(), visited: string[] = []
    await context.route('**/*', (route: Route) => {
      const url = route.request().url(); visited.push(url)
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: new URL(url).hostname === 'company.test'
        ? '<h1>Careers</h1><a href="https://company.teamtailor.com/">Explore open roles</a><a href="https://linkedin.com/company/company">LinkedIn</a>'
        : '<main><h1>Open positions</h1><p>No current positions</p></main>' })
    })
    const result = await createWebsiteStrategy({ reader: createPageReader({ context, minIntervalMs: 0 }), maxPages: 3, concurrency: 1 }).discover([{ name: 'Company', url: 'https://company.test/careers' }])
    assert.equal(result.audit[0].status, 'complete')
    assert.ok(visited.some(url => new URL(url).hostname === 'company.teamtailor.com'))
    assert.ok(visited.every(url => !new URL(url).hostname.endsWith('linkedin.com')))
  } finally { await browser.close() }
})

test('collection retains long descriptions without media and distinct JSON-LD posting URLs', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const context = await browser.newContext(), longBody = 'Backend responsibilities. '.repeat(1800) + 'END-OF-COMPLETE-DESCRIPTION'
    await context.route('**/*', (route: Route) => {
      const listing = new URL(route.request().url()).pathname === '/careers'
      const jobs = [1, 2].map(id => ({ '@type': 'JobPosting', title: 'Senior Engineer', datePosted: '2026-09-13', url: `https://body.test/jobs/${id}`, description: '<p>Job details</p><video>MEDIA_PAYLOAD</video><img src="data:image/png;base64,payload"><script>UNWANTED_SCRIPT</script>' }))
      return route.fulfill({ contentType: 'text/html', body: listing
        ? `<script type="application/ld+json">${JSON.stringify(jobs).replaceAll('<', '\\u003c')}</script>`
        : `<main><h1>Senior Engineer</h1><p>${longBody}</p><video>MEDIA_PAYLOAD</video><img src="data:image/png;base64,payload"><button>Apply now</button></main><footer>UNRELATED_FOOTER</footer>` })
    })
    const reader = createPageReader({ context, minIntervalMs: 0 })
    const listing = await reader.read('https://body.test/careers')
    assert.equal(new Set(listing.jobs.map(job => job.url)).size, 2)
    assert.ok(listing.jobs.every(job => job.publishedAt === '2026-09-13'))
    assert.ok(listing.jobs.every(job => !/MEDIA_PAYLOAD|UNWANTED_SCRIPT|data:image/.test(job.description)))
    const detail = await reader.read('https://body.test/jobs/1')
    assert.ok(detail.jobs[0].description.length > 35000)
    assert.match(detail.jobs[0].description, /END-OF-COMPLETE-DESCRIPTION/)
    assert.doesNotMatch(detail.jobs[0].description, /MEDIA_PAYLOAD|data:image|UNRELATED_FOOTER/)
  } finally { await browser.close() }
})

test('collection records and replays semantic controls, never unchecked redirects or submission controls', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const context = await browser.newContext(), actions:any[]=[]
    await context.route('**/*', (route: Route) => route.fulfill({contentType:'text/html',body:'<h1>Careers</h1><button onclick="this.hidden=true; document.querySelector(\'main\').innerHTML=\'<a href=/jobs/one>Senior Developer</a>\'">Show all open positions</button><main></main>'}))
    const reader=createPageReader({context,minIntervalMs:0})
    const first=await reader.read('https://controls.test/careers',{onAction:async a=>{actions.push(a)}})
    assert.equal(first.controls?.[0].name,'Show all open positions')
    const replay=await reader.read('https://controls.test/careers',{steps:first.controls})
    assert.deepEqual(replay.links,first.links)
    assert.equal(replay.partial,false)
    assert.ok(actions.some(a=>a.operation==='click'))
    await assert.rejects(reader.read('https://controls.test/careers',{steps:[{operation:'click',role:'button',name:'Submit application'}]}),/recipe_control_not_allowed/)
    let fetches=0
    const ats=createPageReader({context,minIntervalMs:0,fetchImpl:async(_url,init)=>{fetches++;assert.equal(init?.redirect,'error');return new Response(JSON.stringify({jobs:[]}))}})
    assert.equal((await ats.read('https://jobs.ashbyhq.com/fixture')).explicitlyEmpty,true)
    await assert.rejects(ats.read('https://linkedin.com/company/fixture'),/excluded/)
    assert.equal(fetches,1)
  } finally { await browser.close() }
})

test('shared collection clears role searches and preserves non-engineering vacancies', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const context = await browser.newContext()
    const source = { name: 'Mixed company', url: 'https://mixed.test/careers' }
    await context.route('**/*', (route: Route) => {
      const path = new URL(route.request().url()).pathname
      const body = path === '/careers'
        ? `<input type="search" aria-label="Search jobs" value="engineer"><div id="jobs"></div><script>
          const search = document.querySelector('input');
          function show() { document.querySelector('#jobs').innerHTML = search.value ? '<a href="/jobs/backend">Senior Backend Engineer</a>' : '<a href="/jobs/backend">Senior Backend Engineer</a><a href="/jobs/analyst">Senior Data Analyst</a>'; }
          search.oninput = show; search.onkeydown = show; show();</script>`
        : `<h1>${path.endsWith('analyst') ? 'Senior Data Analyst' : 'Senior Backend Engineer'}</h1><p>Responsibilities: collaborate with product teams, deliver complete projects, document results and improve reliable data workflows. Qualifications: relevant production experience and communication skills.</p><button>Apply now</button>`
      return route.fulfill({ contentType: 'text/html', body })
    })
    const reader = createPageReader({ context, minIntervalMs: 0 })
    const result = await collectVacancies({ runId: 'all-stacks', sources: [source] }, { strategy: createWebsiteStrategy({ reader }) })
    assert.deepEqual(result.positions.map(p => p.title).sort(), ['Senior Backend Engineer', 'Senior Data Analyst'])
    assert.equal(result.audit[0].status, 'complete')
    assert.equal(result.audit[0].pages.length, 3)
  } finally { await browser.close() }
})

test('employer own-words AI disqualification is detected without blocking permitted AI use', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<label>During this application process I agree to use only my own words. I understand that plagiarism, the use of AI or other generated content will disqualify my application.</label>')
    assert.equal((await inspectForm(page)).aiBan, true)
    await page.setContent('<p>We use AI to review applications. You may use AI to prepare your application.</p>')
    assert.equal((await inspectForm(page)).aiBan, false)
  } finally { await browser.close() }
})

for (const [name, url] of Object.entries({ ashby: 'https://jobs.ashbyhq.com/fixture/123/application', greenhouse: 'https://job-boards.greenhouse.io/fixture/jobs/123', lever: 'https://jobs.lever.co/fixture/123/apply', recruitee: 'https://fixture.recruitee.com/o/123', bamboohr: 'https://fixture.bamboohr.com/careers/123' })) {
  test(`${name}: real browser input/file/consent/select and receipt contract`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'external-browser-'))
    const browser = await launchFixtureBrowser({ headless: true })
    try {
      const context = await browser.newContext(); const pdf = Buffer.from('%PDF-1.4 test'), path = join(root, 'cv.pdf'); await writeFile(path, pdf)
      const candidate: Candidate = { id: 'fixture', createdAt: '', history: [], criteria: { titles: ['fullstack'] }, cv: { path, fileName: 'cv.pdf', sha256: createHash('sha256').update(pdf).digest('hex') }, facts: Object.fromEntries(Object.entries({ fullName: 'Test Candidate', email: 'test@example.org', 'answer:Experience*': '5+ years' }).map(([k, value]) => [k, { value, source: 'confirmed', evidence: 'fixture fact' }])) }
      let submissions = 0
      await context.route('**/*', async (route: any) => {
        if (route.request().method() === 'POST') { submissions++; await route.fulfill({ json: { accepted: true } }); return }
        await route.fulfill({ contentType: 'text/html', body: `<form><label for="name">Name*</label><input id="name" required><label for="email">Email*</label><input type="email" id="email" required><label for="resume">Resume</label><input id="resume" type="file" required><label for="exp">Experience*</label><select id="exp" required><option value="">Select</option><option>5+ years</option></select><label for="consent">I consent to processing personal data*</label><input id="consent" type="checkbox" required><button type="submit">Submit Application</button></form><script>const saved={};for(const e of document.querySelectorAll('input,select'))e.addEventListener('change',()=>{saved[e.id]=e.value});document.querySelector('form').onsubmit=async e=>{e.preventDefault();if(!saved.name||!saved.email||!document.querySelector('#resume').files.length)return;await fetch('/submit',{method:'POST',body:JSON.stringify(saved)});document.body.innerHTML='<h1>Thank you for applying</h1>'};</script>` })
      })
      const p: Position = { id: positionId(url), url, applyUrl: url, company: 'Fixture', title: 'Senior Fullstack', location: 'Spain', description: 'Fixture job', source: { name: 'fixture', url }, retrievedAt: '' }
      const session = await createAtsAdapters({ context, evidenceRoot: root, outcomeTimeoutMs: 1000 }).find(a => a.name === name)!.open(p)
      const form = await session.inspect(), answers = await createAnswerGenerator().generate(candidate, p, form)
      assert.deepEqual(answers.missing, []); assert.equal(submissions, 0)
      await session.fill(candidate, answers); assert.deepEqual(await session.verify(candidate, answers), [])
      const result = await session.submit(); assert.equal(result.status, 'succeeded'); assert.ok(result.evidence?.screenshot); assert.equal(submissions, 1)
      await session.close(); await context.close()
    } finally { await browser.close(); await rm(root, { recursive: true, force: true }) }
  })
}

test('BambooHR opens the application form instead of treating the job-link input as an application', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<label>Link to This Job<input id="job-link"></label><button id="apply">Apply for This Job</button><script>document.querySelector("#apply").onclick=()=>setTimeout(()=>{document.body.innerHTML="<label>First Name<input id=firstName required></label><label>Email<input type=email required></label><button>Submit application</button>"},900)</script>' }))
    const url = 'https://fixture.bamboohr.com/careers/123'
    const position: Position = { id: positionId(url), url, applyUrl: url, company: 'Fixture', title: 'Senior Java Developer', location: '', description: '', source: { name: 'Fixture', url }, retrievedAt: '' }
    const adapter = createAtsAdapters({ context, evidenceRoot: tmpdir() }).find(a => a.name === 'bamboohr')!
    assert.equal(adapter.supports(position), true)
    assert.equal(adapter.supports({ ...position, applyUrl: url + '/apply' }), false)
    const session = await adapter.open(position)
    const form = await session.inspect()
    assert.ok(form.fields.some(field => field.label === 'First Name'))
    assert.ok(form.fields.some(field => field.label === 'Email'))
    assert.ok(!form.fields.some(field => field.label === 'Link to This Job'))
    await session.close(); await context.close()
  } finally { await browser.close() }
})

test('BambooHR maps its required resume and Fabric country to verified saved controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bamboo-form-'))
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<label>Please leave this field blank<input id="nickname_hpcsaf"></label><label>First Name*<input id="firstName"></label><label>Address*<input id="FabricTextField-332" required></label><label>Postal Code*<input id="FabricTextField-335" required></label><label>Resume*<input type="file" aria-label="file-input" required></label><div class="fab-Select"><button aria-label="Country Greece" type="button">Greece</button><select name="countryId.value" aria-hidden="true" required><option value="85">Greece</option><option value="200">Spain</option></select></div><div role="menu" hidden><div role="menuitem">Spain</div></div><script>const button=document.querySelector('button'),menu=document.querySelector('[role=menu]');button.onclick=()=>menu.hidden=false;menu.querySelector('[role=menuitem]').onclick=()=>{button.textContent='Spain';button.setAttribute('aria-label','Country Spain');document.querySelector('select').value='200';menu.hidden=true}</script>` }))
    const page = await context.newPage(); await page.goto('https://fixture.bamboohr.com/careers/123')
    const form = await inspectForm(page)
    assert.ok(!form.fields.some(field => field.label === 'Please leave this field blank'))
    assert.ok(form.fields.some(field => field.label === 'Resume/CV' && field.required))
    assert.ok(form.fields.some(field => field.key === 'button-combobox:bamboo-country' && field.required))
    const pdf = Buffer.from('%PDF-1.4 fixture'), pdfPath = join(root, 'fixture.pdf'); await writeFile(pdfPath, pdf)
    const candidate: any = { cv: { fileName: 'fixture.pdf', sha256: createHash('sha256').update(pdf).digest('hex'), path: pdfPath }, facts: {} }
    const answers: any = { values: Object.fromEntries([['id:firstName','Test'],['id:FabricTextField-332','1 Fixture Street'],['id:FabricTextField-335','08000'],['button-combobox:bamboo-country','Spain']].map(([key,value])=>[key,{value,evidence:['fixture']}])), missing: [] }
    await fillFields(page, candidate, answers, async () => {})
    assert.equal(await page.locator('select[name="countryId.value"]').inputValue(), '200')
    assert.deepEqual(await verifyFields(page, candidate, answers), [])
    await page.locator('select[name="countryId.value"]').selectOption('85', { force: true })
    assert.ok((await verifyFields(page, candidate, answers)).includes('Country backing value not saved: Country'))
    await context.close()
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }) }
})

test('BambooHR continues filling when a text control is replaced during input', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<label>First Name<input id="firstName" oninput="this.id='firstNameSaved'"></label><label>Address<input id="FabricTextField-332"></label>` }))
    const page = await context.newPage(); await page.goto('https://fixture.bamboohr.com/careers/123')
    const candidate: any = { facts: {} }
    const answers: any = { values: { 'id:firstName': { value: 'Test', evidence: ['fixture'] }, 'id:FabricTextField-332': { value: '1 Fixture Street', evidence: ['fixture'] } }, missing: [] }
    await fillFields(page, candidate, answers, async () => {})
    assert.equal(await page.locator('#firstNameSaved').inputValue(), 'Test')
    assert.equal(await page.locator('#FabricTextField-332').inputValue(), '1 Fixture Street')
    await context.close()
  } finally { await browser.close() }
})

test('Ashby autosave error is detected before the submit click', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  const context = await browser.newContext()
  try {
    let submits = 0
    await context.route('**/*', async (route: any) => {
      if (route.request().method() === 'POST') { if (route.request().url().endsWith('/submit')) submits++; await route.fulfill({ json: { errors: [{ message: 'Missing entry for required field' }] } }); return }
      await route.fulfill({ contentType: 'text/html', body: '<label for="name">Name*</label><input id="name" required onchange="fetch(\'/api\',{method:\'POST\',body:\'ApiSetFormValue\'})"><button onclick="fetch(\'/submit\',{method:\'POST\'})">Submit Application</button>' })
    })
    const url = 'https://jobs.ashbyhq.com/fixture/failed/application', p: Position = { id: positionId(url), company: 'Fixture', title: 'Senior', url, applyUrl: url, location: '', description: '', retrievedAt: '', source: { name: 'Fixture', url } }
    const session = await createAtsAdapters({ context, evidenceRoot: tmpdir() }).find(a => a.name === 'ashby')!.open(p)
    const { fillFields } = await import('../applications/form-fields.ts')
    // Exercise the same session synchronization through fill with an actual immutable PDF.
    const root = await mkdtemp(join(tmpdir(), 'external-save-')); const bytes = Buffer.from('%PDF-1.4 fixture'); const path = join(root, 'cv.pdf'); await writeFile(path, bytes)
    const candidate: Candidate = { id: 'save', facts: {}, criteria: { titles: [] }, createdAt: '', history: [], cv: { path, fileName: 'cv.pdf', sha256: createHash('sha256').update(bytes).digest('hex') } }
    try { await assert.rejects(session.fill(candidate, { values: { 'id:name': { value: 'Test', evidence: ['test'] } }, missing: [] }), /acknowledge/); assert.equal(submits, 0) }
    finally { await session.close(); await rm(root, { recursive: true, force: true }) }
  } finally { await context.close(); await browser.close() }
})

test('grouped choices are scoped, multi-select works, and new required conditional answers block submission', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<fieldset><legend>Ownership*</legend><label><input type="checkbox">Frontend</label><label><input type="checkbox">Backend</label></fieldset>
      <fieldset><legend>First*</legend><label><input type="radio" name="first" value="yes">Yes</label><label><input type="radio" name="first" value="no">No</label></fieldset>
      <fieldset><legend>Second*</legend><label><input type="radio" name="second" value="yes">Yes</label><label><input type="radio" name="second" value="no">No</label></fieldset>
      <fieldset><label>Employed?*</label><button aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">Yes</button><button aria-pressed="false">No</button></fieldset>
      <label for="kind">Type*</label><select required id="kind" onchange="document.querySelector('#extra').hidden=false"><option></option><option>Other</option></select>
      <div id="extra" hidden><label for="detail">Details*</label><input id="detail" required></div>
      <p>Candidates may not apply to more than 1 role within a 15 days window.</p>`)
    const form = await inspectForm(page)
    assert.equal(form.minimumDaysBetweenApplications, 15)
    assert.equal(form.fields.filter(f => f.type === 'checkbox-group').length, 1)
    const answers = { values: Object.fromEntries(form.fields.map(f => [f.key, { value: f.type === 'checkbox-group' ? '["Frontend","Backend"]' : f.type === 'select' ? 'Other' : f.label.startsWith('Second') ? 'No' : 'Yes', evidence: ['fixture'] }])), missing: [] }
    const candidate = { facts: {} } as Candidate
    await fillFields(page, candidate, answers, async () => {})
    const errors = await verifyFields(page, candidate, answers)
    assert.deepEqual(errors, ['Required answer missing: Details*'])
    assert.equal(await page.locator('[name="first"][value="yes"]').isChecked(), true)
    assert.equal(await page.locator('[name="second"][value="no"]').isChecked(), true)
  } finally { await browser.close() }
})
test('Greenhouse select proxies are not questions; selected values and generic Attach CV labels are verified', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<div class="select-shell"><label for="country">Country*</label><span id="selected"></span><div class="select__input-container"><input id="country" role="combobox" required oninput="document.querySelector('#options').hidden=false"></div><input id="proxy" aria-hidden="true" tabindex="-1" required></div>
      <div id="options" role="listbox" hidden><div role="option" onclick="document.querySelector('#selected').textContent='Spain';document.querySelector('#proxy').value='ES';document.querySelector('#country').value='';document.querySelector('#options').hidden=true">Spain</div></div>
      <label for="resume">Attach</label><input type="file" id="resume">`)
    const inspection = await inspectForm(page)
    assert.equal(inspection.fields.length, 2); assert.equal(inspection.fields.find(f => f.type === 'file')?.label, 'Resume/CV')
    await page.locator('#resume').evaluate((e: Element) => e.remove())
    const answers = { values: { 'id:country': { value: 'Spain', evidence: ['fixture'] } }, missing: [] }, candidate = { facts: {} } as Candidate
    await fillFields(page, candidate, answers, async () => {})
    assert.deepEqual(await verifyFields(page, candidate, answers), [])
    await page.locator('#proxy').evaluate((e: HTMLInputElement) => { e.value = '' })
    assert.ok((await verifyFields(page, candidate, answers)).some(e => e.includes('required value not saved')))
  } finally { await browser.close() }
})

test('autocomplete opens the dropdown and prefers an exact city over overlapping suggestions', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<label for="city">Location</label><input id="city" role="combobox" aria-expanded="false" onkeydown="if(event.key==='ArrowDown'){document.querySelector('#options').hidden=false;this.setAttribute('aria-expanded','true')}">
      <div id="options" hidden><div role="option" onclick="document.querySelector('#city').value='Barcelona, Barcelona, Spain'">Barcelona, Barcelona, Spain</div><div role="option" onclick="document.querySelector('#city').value='Barcelona, Spain';document.querySelector('#options').hidden=true">Barcelona, Spain</div></div>`)
    const candidate: Candidate = { id: 'fixture', cv: { path: '', sha256: '', fileName: '' }, criteria: { titles: [] }, history: [], createdAt: '', facts: { city: { value: 'Barcelona', source: 'confirmed', evidence: 'fixture' }, country: { value: 'Spain', source: 'confirmed', evidence: 'fixture' } } }
    const answers = { values: { 'id:city': { value: 'Barcelona, Spain', evidence: ['fixture'] } }, missing: [] }
    await fillFields(page, candidate, answers, async () => {})
    assert.deepEqual(await verifyFields(page, candidate, answers), [])
  } finally { await browser.close() }
})

test('Ashby Yes/No checkbox proxies cannot hide required choices', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<div class="ashby-application-form-field-entry"><label class="required">Can you attend?*</label><div class="ashby-application-form-input-yesno"><button aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">Yes</button><button aria-pressed="false">No</button><input type="checkbox" tabindex="-1" style="display:none"></div></div>`)
    const inspection = await inspectForm(page)
    assert.equal(inspection.fields.length, 1); assert.equal(inspection.fields[0].type, 'toggle')
    assert.equal(inspection.fields[0].required, true)
    const candidate = { facts: {} } as Candidate, answers = { values: { [inspection.fields[0].key]: { value: 'Yes', evidence: ['fixture'] } }, missing: [] }
    assert.ok((await verifyFields(page, candidate, answers)).some(e => e.includes('Toggle not saved')))
    await fillFields(page, candidate, answers, async () => {})
    assert.deepEqual(await verifyFields(page, candidate, answers), [])
  } finally { await browser.close() }
})

test('collapsed dialing-country display is verified from the selected option', async () => {
  const browser = await launchFixtureBrowser({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(`<div class="select-shell"><label for="country">Country*</label><span>+995</span><input id="country" role="combobox" onclick="document.querySelector('#options').hidden=false" onkeydown="if(event.key==='Escape')document.querySelector('#options').hidden=true"></div><div id="options" hidden><div role="option" aria-selected="true">Georgia +995</div><div role="option" aria-selected="false">Spain +34</div></div>`)
    const candidate = { facts: {} } as Candidate
    assert.deepEqual(await verifyFields(page, candidate, { values: { 'id:country': { value: 'Georgia +995', evidence: ['fixture'] } }, missing: [] }), [])
    assert.ok((await verifyFields(page, candidate, { values: { 'id:country': { value: 'Spain +34', evidence: ['fixture'] } }, missing: [] })).length)
  } finally { await browser.close() }
})
