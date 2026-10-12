import test from 'node:test'
import assert from 'node:assert/strict'
import { readPublicBoard } from '../vacancy_collection/public-board-reader.ts'

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

test('legacy BambooHR jobs board uses the verified same-employer public careers endpoint', async () => {
  const page=await readPublicBoard('https://chainstack.bamboohr.com/jobs/',async(input)=>{
    assert.equal(String(input),'https://chainstack.bamboohr.com/careers/list')
    return reply({meta:{totalCount:1},result:[{id:'123',jobOpeningName:'Senior Go Developer'}]})
  })
  assert.equal(page?.jobs[0].url,'https://chainstack.bamboohr.com/careers/123')
  assert.equal(page?.partial,false)
})

test('BambooHR listing metadata yields same-host detail reads without claiming complete details', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const page = await readPublicBoard('https://fxpro.bamboohr.com/careers/', async (input, init) => {
    calls.push({ url: String(input), init }); return reply({ meta: { totalCount: 2 }, result: [
      { id: '591', jobOpeningName: 'Senior Java Developer', location: { city: 'Cyprus', state: 'Ypsonas' } },
      { id: '846', jobOpeningName: 'DevOps Engineer', atsLocation: { country: 'Cyprus', city: 'Limassol' }, isRemote: true }
    ] })
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://fxpro.bamboohr.com/careers/list')
  assert.equal(calls[0].init?.redirect, 'error')
  assert.equal(page?.completeListing, undefined)
  assert.equal(page?.partial, false)
  assert.equal(page?.explicitlyEmpty, false)
  assert.deepEqual(page?.jobs.map(job => [job.title, job.url, job.description]), [
    ['Senior Java Developer', 'https://fxpro.bamboohr.com/careers/591', ''],
    ['DevOps Engineer', 'https://fxpro.bamboohr.com/careers/846', '']
  ])
  assert.deepEqual(page?.links.map(link => link.url), page?.jobs.map(job => job.url))
})

test('Breezy listing preserves explicit date and location for separate detail reads', async () => {
  const page = await readPublicBoard('https://joom-group.breezy.hr/', async (input, init) => {
    assert.equal(String(input), 'https://joom-group.breezy.hr/json')
    assert.equal(init?.redirect, 'error')
    return reply([{ id: '3b2baa070de8', friendly_id: '3b2baa070de8-application-security-engineer', name: 'Application Security Engineer', url: 'https://joom-group.breezy.hr/p/3b2baa070de8-application-security-engineer', published_date: '2026-09-29T10:00:00Z', location: { name: 'Lisbon, PT', is_remote: false }, company: { name: 'Joom' } }])
  })
  assert.equal(page?.method, 'breezy-listing')
  assert.equal(page?.jobs[0].publishedAt, '2026-09-29T10:00:00Z')
  assert.equal(page?.jobs[0].location, 'Lisbon, PT')
  assert.equal(page?.jobs[0].company, 'Joom')
  assert.equal(page?.jobs[0].description, '')
  assert.equal(page?.completeListing, undefined)
})

test('empty listings are explicit only with valid contracts', async () => {
  const bamboo = await readPublicBoard('https://empty.bamboohr.com/careers', async () => reply({ meta: { totalCount: 0 }, result: [] }))
  const breezy = await readPublicBoard('https://empty.breezy.hr/', async () => reply([]))
  assert.equal(bamboo?.explicitlyEmpty, true)
  assert.equal(breezy?.explicitlyEmpty, true)
  await assert.rejects(readPublicBoard('https://broken.bamboohr.com/careers', async () => reply({ result: {} })), /validated postings list/)
  await assert.rejects(readPublicBoard('https://broken.breezy.hr/', async () => reply({ positions: [] })), /validated postings list/)
})

test('count mismatches, malformed rows, and cross-host Breezy URLs remain partial', async () => {
  const mismatch = await readPublicBoard('https://count.bamboohr.com/careers', async () => reply({ meta: { totalCount: 2 }, result: [{ id: '1', jobOpeningName: 'Java Developer' }] }))
  assert.equal(mismatch?.partial, true)
  assert.equal(mismatch?.explicitlyEmpty, false)
  const crossHost = await readPublicBoard('https://safe.breezy.hr/', async () => reply([{ id: 'abc123', friendly_id: 'abc123-java-developer', name: 'Java Developer', url: 'https://evil.example/p/abc123-java-developer' }]))
  assert.equal(crossHost?.jobs.length, 0)
  assert.equal(crossHost?.partial, true)
  assert.equal(crossHost?.explicitlyEmpty, false)
})

test('BambooHR detail binds identity and preserves readable requirements without invented dates', async () => {
  const job={jobOpeningShareUrl:'https://fxpro.bamboohr.com/careers/591',jobOpeningName:'Senior Java Developer',jobOpeningStatus:'Open',description:'<p>Build Java services.</p><p>Spring and PostgreSQL required.</p>',location:{city:'Limassol'}}
  const page=await readPublicBoard(job.jobOpeningShareUrl,async(input)=>{assert.equal(String(input),job.jobOpeningShareUrl+'/detail');return reply({result:{jobOpening:job}})})
  assert.equal(page?.jobs[0].url,job.jobOpeningShareUrl)
  assert.match(page!.jobs[0].description,/Spring and PostgreSQL required/)
  assert.equal(page?.jobs[0].publishedAt,undefined)
  for(const change of [{jobOpeningShareUrl:'https://other.bamboohr.com/careers/591'},{jobOpeningShareUrl:'https://fxpro.bamboohr.com/careers/592'},{description:''},{jobOpeningStatus:'Closed'}]){
    const invalid=await readPublicBoard(job.jobOpeningShareUrl,async()=>reply({result:{jobOpening:{...job,...change}}}))
    assert.equal(invalid?.partial,true);assert.equal(invalid?.jobs.length,0)
  }
})

test('unsupported detail and vendor URLs are not intercepted', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; return reply([]) }
  for (const url of [
    'https://fxpro.bamboohr.com/careers/list',
    'https://joom-group.breezy.hr/p/3b2baa070de8-role',
    'https://www.bamboohr.com/careers',
    'https://app.breezy.hr/'
  ]) assert.equal(await readPublicBoard(url, fetchImpl), undefined)
  assert.equal(calls, 0)
})
