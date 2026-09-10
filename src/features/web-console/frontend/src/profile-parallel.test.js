import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProfileFiller } from './profile-filler-controller.js'
import { createProfileWorkspace } from './profile-filler-workspace.js'

const account = id => ({ platformAccountId: id, clientName: `Fixture ${id}` })
const preview = id => ({ jobId: `job-${id}`, platformAccountId: id, status: 'preview_ready',
  planHash: `hash-${id}`, preview: { issues: [], document: { profile: { headline: `Author ${id}` } } } })
const turn = () => new Promise(resolve => setImmediate(resolve))

test('two accounts generate and Apply independently without mixing CV, approval or observers', async () => {
  const generations = new Map(), reads = new Map(), applies = [], jobs = new Map()
  const workspace = createProfileWorkspace(() => createProfileFiller({
    adminProfileJobs: async () => ({ jobs: [...jobs.values()] }),
    startAdminProfileGeneration: (id, file) => new Promise(resolve => generations.set(id, { file, resolve })),
    adminProfileJob: id => new Promise(resolve => reads.set(id, resolve)),
    applyAdminProfileJob: async (id, hash) => {
      applies.push([id, hash])
      const job = { ...jobs.get(id), status: 'verifying' }
      jobs.set(id, job)
      return job
    }
  }))
  try {
    await workspace.open(account(1))
    const first = workspace.selected.value
    first.chooseGenerationFile({ target: { files: [{ name: 'first.pdf', size: 10, type: 'application/pdf' }] } })
    const firstRequest = first.generate()
    await workspace.open(account(2))
    const second = workspace.selected.value
    assert.equal(first.visible.value, false)
    assert.equal(second.cvFile.value, null)
    const secondRequest = second.generate()
    await first.generate()
    assert.equal(generations.size, 2, 'one request per account, not a global lock')
    assert.equal(generations.get(1).file.name, 'first.pdf')
    assert.equal(generations.get(2).file, undefined)
    for (const id of [1, 2]) {
      const job = preview(id)
      jobs.set(job.jobId, job)
      generations.get(id).resolve(job)
    }
    await Promise.all([firstRequest, secondRequest])
    for (const id of [1, 2]) reads.get(`job-${id}`)(preview(id))
    await turn()
    first.apply(); second.apply()
    assert.equal(first.confirmation.value.planHash, 'hash-1')
    assert.equal(second.confirmation.value.planHash, 'hash-2')
    await Promise.all([first.confirm(), second.confirm(), first.confirm()])
    assert.deepEqual(applies, [['job-1', 'hash-1'], ['job-2', 'hash-2']])
    assert.equal(first.active.value && second.active.value, true)
    assert.equal(workspace.busy.value, true)
    await workspace.open(account(1))
    assert.equal(workspace.selected.value, first)
    assert.equal(first.cvFile.value.name, 'first.pdf')
    assert.equal(first.draft.value.profile.headline, 'Author 1')
    assert.equal(second.draft.value.profile.headline, 'Author 2')
    reads.get('job-2')({ ...preview(2), status: 'succeeded' })
    await turn()
    assert.equal(second.active.value, false)
    assert.equal(first.active.value, true, 'finishing one account does not finish another')
    assert.equal(workspace.busy.value, true)
  } finally { workspace.dispose() }
})

test('reload restores both jobs through reads only, and reopening does not duplicate observers', async () => {
  const counts = new Map(), replies = new Map()
  const jobs = [1, 2].map(id => ({ ...preview(id), status: 'verifying' }))
  const workspace = createProfileWorkspace(() => createProfileFiller({
    adminProfileJobs: async () => ({ jobs }),
    adminProfileJob: id => { counts.set(id, (counts.get(id) || 0) + 1)
      return new Promise(resolve => replies.set(id, resolve)) }
  }))
  try {
    await workspace.open(account(1)); await workspace.open(account(2)); await workspace.open(account(1))
    assert.deepEqual([...counts.values()], [1, 1])
    workspace.get(account(1)).showHistory({ ...preview(1), jobId: 'old', status: 'succeeded' })
    replies.get('job-2')({ ...preview(2), status: 'succeeded' })
    await turn()
    assert.equal(workspace.selected.value.job.value.jobId, 'old')
    assert.equal(workspace.get(account(2)).trackedJob.value.status, 'succeeded')
  } finally { workspace.dispose() }
  assert.equal(workspace.busy.value, false)
})
