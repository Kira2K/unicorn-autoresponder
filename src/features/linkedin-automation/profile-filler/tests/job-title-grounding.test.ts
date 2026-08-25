import assert from 'node:assert/strict'
import { groundJobTitles } from '../generation/job-title-grounding.ts'
import { jobTitleCatalogQueries, jobTitleQueries } from '../generation/job-title-queries.ts'
import type { ProfileInput } from '../input-types.ts'

const input: ProfileInput = { schemaVersion: 1, skills: { add: [], targetCount: 100 },
  experience: [], education: [], openToWork: {
    jobTitles: [{ name: 'Backend Engineer' }, { name: 'Senior Go Backend Developer' },
      { name: 'Unknown Role' }],
    workplaceTypes: ['REMOTE'], locations: [{ name: 'Poland' }],
    employmentTypes: ['FULL_TIME'], visibility: 'ALL'
  } }

async function run() {
  const events: any[] = []
  const searches: string[] = []
  const result = await groundJobTitles({ input, issues: [], accountId: 'account-1',
    logger: { event: (...args: any[]) => events.push(args) },
    client: { async searchParameters(_account: string, _type: any, keywords: string) {
      searches.push(keywords)
      if (keywords === 'Backend Engineer') return [{ id: 'exact', name: 'Backend Engineer' },
        { id: 'go-1', name: 'Senior Backend Engineer' },
        { id: 'go-2', name: 'Golang Developer' }]
      return [{ id: 'other', name: 'Other Role' }]
    } } as any,
    choose: async requests => [{ index: requests[0].index, candidateId: 'go-1', confident: true },
      { index: requests[1].index, candidateId: 'invented', confident: true }]
  })
  assert.deepEqual(result.input.openToWork?.jobTitles, [
    { id: 'exact', name: 'Backend Engineer' },
    { id: 'go-1', name: 'Senior Backend Engineer' }
  ])
  assert(result.issues.some(issue => issue.level === 'warning' &&
    issue.path === 'profile.open_to_work.job_titles'))
  assert(searches.length <= 3)
  assert.equal(JSON.stringify(events).includes('Senior Go Backend Developer'), false)
  assert.deepEqual(jobTitleQueries('Senior Backend Engineer (Go)'),
    ['Senior Backend Engineer (Go)', 'Senior Backend Engineer', 'Backend Engineer',
      'Software Engineer'])
  assert.deepEqual(jobTitleCatalogQueries(['Senior Go Developer', 'Software Engineer']),
    ['Backend Engineer', 'Software Engineer', 'Software Developer'])

  const guaranteedInput = structuredClone(input)
  guaranteedInput.openToWork!.jobTitles = Array.from({ length: 5 }, (_, index) =>
    ({ name: `Generated Role ${index + 1}` }))
  const skipped = await groundJobTitles({ input: guaranteedInput, issues: [],
    accountId: 'account-1', logger: { event() {} }, client: {
      async searchParameters() {
        return Array.from({ length: 5 }, (_, index) =>
          ({ id: `role-${index + 1}`, name: `Catalog Role ${index + 1}` }))
      }
    } as any, choose: async () => { throw Object.assign(new Error('incomplete'),
      { code: 'openai_response_incomplete' }) } })
  assert.equal(skipped.input.openToWork, undefined)
  assert(skipped.issues.some(issue => issue.level === 'warning' &&
    issue.path === 'profile.open_to_work'))

  const partialInput = structuredClone(guaranteedInput)
  const partial = await groundJobTitles({ input: partialInput, issues: [], accountId: 'account-1',
    logger: { event() {} }, client: { async searchParameters() {
      return [{ id: 'backend', name: 'Backend Engineer' },
        { id: 'software', name: 'Software Engineer' }]
    } } as any, choose: async requests => requests.slice(0, 2).map((request, index) => ({
      index: request.index, candidateId: index ? 'software' : 'backend', confident: true
    })) })
  assert.equal(partial.input.openToWork?.jobTitles.length, 2)
  assert.equal(new Set(partial.input.openToWork?.jobTitles.map(item => item.id)).size, 2)
  assert(partial.issues.some(issue => issue.message.includes('Only 2 of 5')))
}

run().then(() => console.log('job title grounding tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
