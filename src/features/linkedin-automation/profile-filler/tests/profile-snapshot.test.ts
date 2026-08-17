const assert = require('node:assert/strict')
const test = require('node:test')
const {
  buildSectionStates,
  InMemoryProfileSnapshotStore,
  ProfileSnapshotStoreError,
  snapshotReference,
} = require('../profile-snapshot.ts') as typeof import('../profile-snapshot.ts')

test('snapshot distinguishes complete, empty, throttled and missing sections', () => {
  const states = buildSectionStates({
    description: '',
    specifics: {
      experience: [],
      education: [{ id: 'education-1' }],
      skills: [{ name: 'Python' }],
      is_open_to_work: false,
      throttled_sections: ['linkedin_skills'],
    },
  }, ['headline', 'about', 'experience', 'education', 'skills', 'open_to_work'])

  assert.equal(states.headline.status, 'empty')
  assert.equal(states.about.status, 'missing')
  assert.equal(states.experience.status, 'empty')
  assert.equal(states.experience.itemCount, 0)
  assert.equal(states.education.status, 'complete')
  assert.equal(states.education.itemCount, 1)
  assert.equal(states.skills.status, 'throttled')
  assert.equal(states.open_to_work.status, 'empty')
})

test('snapshot store keeps an immutable copy and verifies account, hash and expiry', () => {
  let now = new Date('2026-08-17T00:00:00.000Z')
  const store = new InMemoryProfileSnapshotStore({ ttlMilliseconds: 1000, clock: () => now })
  const profile = { description: 'Original', specifics: { experience: [] } }
  const snapshot = store.save('account-1', profile, ['headline', 'experience'])
  const reference = snapshotReference(snapshot)
  profile.description = 'Mutated outside the store'

  assert.equal(store.verify(reference, 'account-1').profile.description, 'Original')
  assert.throws(
    () => store.verify(reference, 'account-2'),
    (error: unknown) => error instanceof ProfileSnapshotStoreError && error.code === 'snapshot_account_mismatch',
  )
  assert.throws(
    () => store.verify({ ...reference, snapshotHash: 'tampered' }, 'account-1'),
    (error: unknown) => error instanceof ProfileSnapshotStoreError && error.code === 'snapshot_hash_mismatch',
  )
  now = new Date('2026-08-17T00:00:02.000Z')
  assert.throws(
    () => store.verify(reference, 'account-1'),
    (error: unknown) => error instanceof ProfileSnapshotStoreError && error.code === 'snapshot_not_found',
  )
})
