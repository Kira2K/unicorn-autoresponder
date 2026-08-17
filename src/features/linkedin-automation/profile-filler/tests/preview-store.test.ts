const assert = require('node:assert/strict')
const test = require('node:test')
const { InMemoryPreviewStore, PreviewStoreError } = require('../preview-store.ts') as typeof import('../preview-store.ts')

function plan() {
  return {
    account: {
      provider: 'linkedin' as const,
      accountId: 'account-1',
      displayName: 'Test Student',
      verifiedAt: '2026-08-17T00:00:00.000Z',
    },
    identity: { displayName: 'Test Student' },
    issues: [],
    steps: [{
      id: 'headline',
      section: 'headline' as const,
      action: 'update' as const,
      summary: 'Update headline',
      before: 'Before',
      after: 'After',
      payload: { access_token: 'must-never-reach-preview', specifics: { linkedin: { headline: 'After' } } },
      verification: { kind: 'headline' as const, expected: 'After' },
    }],
  }
}

test('preview omits server payload, survives caller mutation and is one-time', () => {
  let now = new Date('2026-08-17T00:00:00.000Z')
  const store = new InMemoryPreviewStore({ ttlMilliseconds: 60_000, clock: () => now })
  const source = plan()
  const preview = store.create(source)
  assert.equal('payload' in preview.steps[0], false)
  assert.equal('verification' in preview.steps[0], false)
  assert.equal(JSON.stringify(preview).includes('must-never-reach-preview'), false)
  source.steps[0].after = 'Tampered locally'
  const consumed = store.consume(preview.planId, preview.planHash, 'account-1')
  assert.equal(consumed.steps[0].after, 'After')
  assert.throws(
    () => store.consume(preview.planId, preview.planHash, 'account-1'),
    (error: unknown) => error instanceof PreviewStoreError && error.code === 'preview_consumed',
  )
})

test('preview rejects hash, account and expiry mismatches', () => {
  let now = new Date('2026-08-17T00:00:00.000Z')
  const store = new InMemoryPreviewStore({ ttlMilliseconds: 1000, clock: () => now })
  let preview = store.create(plan())
  assert.throws(() => store.consume(preview.planId, 'wrong', 'account-1'), /hash/i)
  preview = store.create(plan())
  assert.throws(() => store.consume(preview.planId, preview.planHash, 'account-2'), /аккаунт/i)
  preview = store.create(plan())
  now = new Date('2026-08-17T00:00:02.000Z')
  assert.throws(() => store.consume(preview.planId, preview.planHash, 'account-1'), /истёк/i)
})
