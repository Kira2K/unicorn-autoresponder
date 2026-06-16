const assert = require('node:assert/strict')
const {
  DEFAULT_DOLPHIN_SHARED_USER_ID,
  PROVIDER_DOLPHIN_EMAIL,
  createDolphinLeaseService,
  validateDolphinTargetUser
} = require('./dolphin-lease.ts') as {
  DEFAULT_DOLPHIN_SHARED_USER_ID: number
  PROVIDER_DOLPHIN_EMAIL: string
  createDolphinLeaseService(options: any): any
  validateDolphinTargetUser(users: any[], targetUserId: number): any
}

async function runTests(): Promise<void> {
  assert.equal(DEFAULT_DOLPHIN_SHARED_USER_ID, 5166733)
  assert.equal(PROVIDER_DOLPHIN_EMAIL, 'nospanov9@gmail.com')
  assert.throws(
    () => validateDolphinTargetUser([{ id: 1, username: 'admin@example.com', role: 'admin' }], 1),
    /Refusing to rotate admin/
  )
  assert.throws(() => validateDolphinTargetUser([], 1), /was not found/)

  let currentTime = 1_000
  const timers: Array<() => void> = []
  const updates: Array<{ userId: number; username: string; password: string }> = []
  const accessCalls: Array<{ action: string; userId: number; profileIds: number[] }> = []
  const auditEvents: Array<Record<string, unknown>> = []
  const service = createDolphinLeaseService({
    targetUserId: 5166733,
    leaseMs: 120_000,
    auditLog: (event: Record<string, unknown>) => {
      auditEvents.push(event)
    },
    now: () => currentTime,
    setTimer: (callback: () => void) => {
      timers.push(callback)
      return callback as any
    },
    clearTimer: () => {},
    listUsers: async () => [{ id: 5166733, username: 'judoshark@gmail.com', role: 'user' }],
    updateUser: async (userId: number, patch: { username: string; password: string }) => {
      updates.push({ userId, username: patch.username, password: patch.password })
    },
    removeProfileAccess: async (profileIds: number[], userId: number) => {
      accessCalls.push({ action: 'remove', userId, profileIds })
    },
    shareProfiles: async (profileIds: number[], userId: number) => {
      accessCalls.push({ action: 'share', userId, profileIds })
    }
  })

  const clientLease = await service.acquire({
    ownerKey: 'client:1',
    ownerLabel: 'Client One',
    role: 'client',
    targetClientId: 1,
    targetClientName: 'Client One',
    username: 'client@example.com',
    password: 'client@example.com',
    profileIds: [101, 102],
    knownProfileIds: [101, 102, 201]
  })
  assert.equal(clientLease.username, 'client@example.com')
  assert.equal(clientLease.password, 'client@example.com')
  assert.deepEqual(clientLease.profileIds, [101, 102])
  assert.deepEqual(clientLease.profilesGranted, [101, 102])
  assert.deepEqual(clientLease.profilesRevoked, [101, 102, 201])
  assert.equal(clientLease.expiresAt, 121_000)
  assert.deepEqual(updates, [{ userId: 5166733, username: 'client@example.com', password: 'client@example.com' }])
  assert.deepEqual(accessCalls, [
    { action: 'remove', userId: 5166733, profileIds: [101, 102, 201] },
    { action: 'share', userId: 5166733, profileIds: [101, 102] }
  ])
  assert.deepEqual(auditEvents[0], {
    event: 'dolphin_profile_access_lease_applied',
    dryRun: false,
    sharedUserId: 5166733,
    ownerKey: 'client:1',
    ownerLabel: 'Client One',
    role: 'client',
    targetClientId: 1,
    targetClientName: 'Client One',
    revokedProfileIds: [101, 102, 201],
    grantedProfileIds: [101, 102]
  })
  assert.equal(JSON.stringify(auditEvents[0]).includes('client@example.com'), false)

  const sameOwnerLease = await service.acquire({
    ownerKey: 'client:1',
    ownerLabel: 'Client One',
    role: 'client',
    targetClientId: 1,
    targetClientName: 'Client One',
    username: 'client@example.com',
    password: 'client@example.com',
    profileIds: [101, 102],
    knownProfileIds: [101, 102, 201]
  })
  assert.equal(sameOwnerLease.expiresAt, clientLease.expiresAt)
  assert.equal(updates.length, 1)
  assert.equal(accessCalls.length, 2)
  assert.equal(auditEvents.length, 1)

  await assert.rejects(
    () => service.acquire({
      ownerKey: 'provider:Nariman',
      ownerLabel: 'Nariman',
      role: 'provider',
      targetClientId: 3,
      targetClientName: 'Provider Target',
      username: PROVIDER_DOLPHIN_EMAIL,
      password: PROVIDER_DOLPHIN_EMAIL,
      profileIds: [301],
      knownProfileIds: [101, 102, 201, 301]
    }),
    (error: any) => {
      assert.equal(error.code, 'account_in_use')
      assert.equal(error.message, 'account in use sorry')
      assert.equal(error.activeUntil, 121_000)
      return true
    }
  )

  currentTime = 121_001
  timers[0]()
  const providerLease = await service.acquire({
    ownerKey: 'provider:Nariman',
    ownerLabel: 'Nariman',
    role: 'provider',
    targetClientId: 3,
    targetClientName: 'Provider Target',
    username: PROVIDER_DOLPHIN_EMAIL,
    password: PROVIDER_DOLPHIN_EMAIL,
    profileIds: [301],
    knownProfileIds: [101, 102, 201, 301]
  })
  assert.equal(providerLease.username, PROVIDER_DOLPHIN_EMAIL)
  assert.equal(providerLease.password, PROVIDER_DOLPHIN_EMAIL)
  assert.equal(providerLease.targetClientName, 'Provider Target')
  assert.deepEqual(providerLease.profileIds, [301])
  assert.equal(updates[1].username, PROVIDER_DOLPHIN_EMAIL)
  assert.deepEqual(accessCalls.at(-2), {
    action: 'remove',
    userId: 5166733,
    profileIds: [101, 102, 201, 301]
  })
  assert.deepEqual(accessCalls.at(-1), {
    action: 'share',
    userId: 5166733,
    profileIds: [301]
  })

  let releaseFirstUpdate: () => void = () => {
    throw new Error('first update was not started')
  }
  let markFirstUpdateStarted: (() => void) | null = null
  const firstUpdateStarted = new Promise<void>(resolve => {
    markFirstUpdateStarted = resolve
  })
  const concurrentUpdates: string[] = []
  const concurrentAccess: string[] = []
  const concurrentService = createDolphinLeaseService({
    targetUserId: 5166733,
    leaseMs: 1_000,
    now: () => 5_000,
    setTimer: (callback: () => void) => callback as any,
    clearTimer: () => {},
    listUsers: async () => [{ id: 5166733, username: 'judoshark@gmail.com', role: 'user' }],
    updateUser: async (_userId: number, patch: { username: string }) => {
      concurrentUpdates.push(patch.username)
      markFirstUpdateStarted?.()
      await new Promise<void>(resolve => {
        releaseFirstUpdate = resolve
      })
    },
    removeProfileAccess: async () => {
      concurrentAccess.push('remove')
    },
    shareProfiles: async () => {
      concurrentAccess.push('share')
    }
  })
  const first = concurrentService.acquire({
    ownerKey: 'client:2',
    ownerLabel: 'First',
    role: 'client',
    targetClientId: 2,
    targetClientName: 'First',
    username: 'first@example.com',
    password: 'first@example.com',
    profileIds: [401],
    knownProfileIds: [401, 402]
  })
  const second = concurrentService.acquire({
    ownerKey: 'client:3',
    ownerLabel: 'Second',
    role: 'client',
    targetClientId: 3,
    targetClientName: 'Second',
    username: 'second@example.com',
    password: 'second@example.com',
    profileIds: [402],
    knownProfileIds: [401, 402]
  })
  await firstUpdateStarted
  releaseFirstUpdate()
  await first
  await assert.rejects(second, /account in use sorry/)
  assert.deepEqual(concurrentUpdates, ['first@example.com'])
  assert.deepEqual(concurrentAccess, ['remove', 'share'])
}

runTests()
  .then(() => console.log('web console dolphin lease tests passed'))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
