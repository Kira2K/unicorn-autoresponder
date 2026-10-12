import test from 'node:test'
import assert from 'node:assert/strict'
import { postingIdentity } from '../infrastructure/posting-identity.ts'

test('posting identity uses explicit ATS URL evidence, including embedded Greenhouse links', () => {
  for (const url of ['https://boards.greenhouse.io/acme/jobs/123', 'https://boards.greenhouse.io/embed/job_app?token=123', 'https://acme.test/careers?gh_jid=123']) {
    assert.deepEqual(postingIdentity(url), { platform: 'greenhouse', namespace: 'greenhouse', externalId: '123' })
  }
  const id = '12345678-1234-1234-1234-123456789abc'
  for (const [host, platform] of [['jobs.lever.co', 'lever'], ['jobs.eu.lever.co', 'lever'], ['jobs.ashbyhq.com', 'ashby']]) {
    assert.deepEqual(postingIdentity(`https://${host}/acme/${id}/application`), { platform, namespace: `${platform}:acme`, externalId: id })
  }
  assert.deepEqual(postingIdentity('https://acme.bamboohr.com/careers/12'), { platform: 'bamboohr', namespace: 'bamboohr:acme.bamboohr.com', externalId: '12' })
})

test('identity does not guess boards or treat lookalikes and listing paths as postings', () => {
  for (const url of ['https://evilgreenhouse.io/acme/jobs/123', 'https://greenhouse.io.evil.test/jobs/123', 'https://boards.greenhouse.io/acme', 'https://jobs.ashbyhq.com/acme/apply', 'https://jobs.lever.co/acme', 'https://acme.test/jobs/123']) {
    assert.equal(postingIdentity(url).externalId, null)
  }
})
