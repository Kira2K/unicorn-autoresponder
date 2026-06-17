const assert = require('node:assert/strict')
const {
  DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
  DEFAULT_DOLPHIN_SHARED_USER_ID,
  createDolphinLeaseService,
  dolphinErrorCode,
  normalizeDolphinErrorDetails,
  validateDolphinTargetUser
} = require('./dolphin-lease.ts') as {
  DEFAULT_DOLPHIN_SHARED_USER_EMAIL: string
  DEFAULT_DOLPHIN_SHARED_USER_ID: number
  createDolphinLeaseService(options: any): any
  dolphinErrorCode(error: unknown): string | undefined
  normalizeDolphinErrorDetails(error: unknown): any
  validateDolphinTargetUser(users: any[], targetUserId: number): any
}

async function runTests(): Promise<void> {
  assert.equal(DEFAULT_DOLPHIN_SHARED_USER_ID, 5166733)
  assert.equal(DEFAULT_DOLPHIN_SHARED_USER_EMAIL, 'kind.cute.unicorn@gmail.com')
  const nestedDolphinError = new Error(JSON.stringify({
    message: {
      text: 'You have problem in field email',
      type: 'E_TEAM',
      code: 'E_TEAM_USERNAME'
    }
  }))
  assert.equal(dolphinErrorCode(nestedDolphinError), 'E_TEAM_USERNAME')
  assert.equal(normalizeDolphinErrorDetails(nestedDolphinError).text, 'You have problem in field email')
  assert.throws(
    () => validateDolphinTargetUser([{ id: 1, username: 'admin@example.com', role: 'admin' }], 1),
    /Refusing to rotate admin/
  )
  assert.throws(() => validateDolphinTargetUser([], 1), /was not found/)

  let currentTime = 1_000
  const timers: Array<() => void> = []
  const updates: Array<{ userId: number; username: string; password: string; displayName?: string }> = []
  const operationCalls: Array<{ action: string; userId: number; profileIds?: number[]; username?: string }> = []
  const auditEvents: Array<Record<string, unknown>> = []
  const service = createDolphinLeaseService({
    targetUserId: 5166733,
    stableUsername: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
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
    listUsers: async () => [{ id: 5166733, username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL, role: 'user' }],
    updateUser: async (userId: number, patch: { username: string; password: string; displayName?: string }) => {
      updates.push({ userId, username: patch.username, password: patch.password, displayName: patch.displayName })
      operationCalls.push({ action: 'update', userId, username: patch.username })
    },
    removeProfileAccess: async (profileIds: number[], userId: number) => {
      operationCalls.push({ action: 'remove', userId, profileIds })
    },
    shareProfiles: async (profileIds: number[], userId: number) => {
      operationCalls.push({ action: 'share', userId, profileIds })
    }
  })

  const clientLease = await service.acquire({
    ownerKey: 'client:1',
    ownerLabel: 'Client One',
    role: 'client',
    targetClientId: 1,
    targetClientName: 'Client One',
    username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    password: 'generated-client-pass',
    sourceEmail: 'client@example.com',
    profileIds: [101, 102],
    knownProfileIds: [101, 102, 201]
  })
  assert.equal(clientLease.username, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
  assert.equal(clientLease.sourceEmail, 'client@example.com')
  assert.equal(clientLease.credentialMode, 'stable_shared_email')
  assert.equal(clientLease.dolphinUserId, 5166733)
  assert.equal(clientLease.password, 'generated-client-pass')
  assert.deepEqual(clientLease.profileIds, [101, 102])
  assert.deepEqual(clientLease.profilesGranted, [101, 102])
  assert.deepEqual(clientLease.profilesRevoked, [101, 102, 201])
  assert.equal(clientLease.expiresAt, 121_000)
  assert.deepEqual(updates, [{
    userId: 5166733,
    username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    password: 'generated-client-pass',
    displayName: 'Shared for Client One'
  }])
  assert.deepEqual(operationCalls, [
    { action: 'update', userId: 5166733, username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL },
    { action: 'remove', userId: 5166733, profileIds: [101, 102, 201] },
    { action: 'share', userId: 5166733, profileIds: [101, 102] }
  ])
  assert.deepEqual(auditEvents[0], {
    event: 'dolphin_profile_access_lease_applied',
    dryRun: false,
    dolphinUserId: 5166733,
    credentialMode: 'stable_shared_email',
    ownerKey: 'client:1',
    ownerLabel: 'Client One',
    role: 'client',
    targetClientId: 1,
    targetClientName: 'Client One',
    attemptedUsername: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    sourceEmail: 'client@example.com',
    revokedProfileIds: [101, 102, 201],
    grantedProfileIds: [101, 102]
  })
  assert.equal(JSON.stringify(auditEvents[0]).includes('generated-client-pass'), false)

  const sameOwnerLease = await service.acquire({
    ownerKey: 'client:1',
    ownerLabel: 'Client One',
    role: 'client',
    targetClientId: 1,
    targetClientName: 'Client One',
    username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    password: 'different-pass-that-must-not-apply',
    sourceEmail: 'client@example.com',
    profileIds: [101, 102],
    knownProfileIds: [101, 102, 201]
  })
  assert.equal(sameOwnerLease.expiresAt, clientLease.expiresAt)
  assert.equal(sameOwnerLease.password, 'generated-client-pass')
  assert.equal(updates.length, 1)
  assert.equal(operationCalls.length, 3)
  assert.equal(auditEvents.length, 1)

  await assert.rejects(
    () => service.acquire({
      ownerKey: 'provider:Nariman',
      ownerLabel: 'Nariman',
      role: 'provider',
      targetClientId: 3,
      targetClientName: 'Provider Target',
      username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
      password: 'provider-pass',
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
    username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    password: 'generated-provider-pass',
    profileIds: [301],
    knownProfileIds: [101, 102, 201, 301]
  })
  assert.equal(providerLease.username, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
  assert.equal(providerLease.credentialMode, 'stable_shared_email')
  assert.equal(providerLease.password, 'generated-provider-pass')
  assert.equal(providerLease.targetClientName, 'Provider Target')
  assert.deepEqual(providerLease.profileIds, [301])
  assert.equal(updates[1].username, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
  assert.equal(updates[1].password, 'generated-provider-pass')
  assert.deepEqual(operationCalls.at(-2), {
    action: 'remove',
    userId: 5166733,
    profileIds: [101, 102, 201, 301]
  })
  assert.deepEqual(operationCalls.at(-1), {
    action: 'share',
    userId: 5166733,
    profileIds: [301]
  })

  const alternateStableOperations: Array<Record<string, unknown>> = []
  const alternateStableService = createDolphinLeaseService({
    targetUserId: 5166733,
    stableUsername: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    leaseMs: 1_000,
    now: () => 1,
    setTimer: (callback: () => void) => callback as any,
    clearTimer: () => {},
    listUsers: async () => [
      { id: 5166733, username: 'different-shared@example.com', role: 'user' },
      { id: 7002, username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL, role: 'user' }
    ],
    updateUser: async (userId: number, patch: { username: string; password: string }) => {
      alternateStableOperations.push({ action: 'update', userId, username: patch.username, password: patch.password })
    },
    removeProfileAccess: async (profileIds: number[], userId: number) => {
      alternateStableOperations.push({ action: 'remove', userId, profileIds })
    },
    shareProfiles: async (profileIds: number[], userId: number) => {
      alternateStableOperations.push({ action: 'share', userId, profileIds })
    }
  })
  const alternateStableLease = await alternateStableService.acquire({
    ownerKey: 'client:7',
    ownerLabel: 'Alternate Stable',
    role: 'client',
    targetClientId: 7,
    targetClientName: 'Alternate Stable',
    username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    password: 'alternate-stable-pass',
    sourceEmail: 'client7@example.com',
    profileIds: [701],
    knownProfileIds: [701, 702]
  })
  assert.equal(alternateStableLease.dolphinUserId, 7002)
  assert.equal(alternateStableLease.username, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
  assert.deepEqual(alternateStableOperations, [
    { action: 'update', userId: 7002, username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL, password: 'alternate-stable-pass' },
    { action: 'remove', userId: 7002, profileIds: [701, 702] },
    { action: 'share', userId: 7002, profileIds: [701] }
  ])

  const adminStableEmailService = createDolphinLeaseService({
    targetUserId: 5166733,
    stableUsername: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    leaseMs: 1_000,
    now: () => 1,
    setTimer: (callback: () => void) => callback as any,
    clearTimer: () => {},
    listUsers: async () => [
      { id: 5166733, username: 'different-shared@example.com', role: 'user' },
      { id: 7003, username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL, role: 'admin' }
    ],
    updateUser: async () => {
      throw new Error('admin stable user must not be patched')
    },
    removeProfileAccess: async () => {
      throw new Error('admin stable user must not receive profile changes')
    },
    shareProfiles: async () => {
      throw new Error('admin stable user must not receive profile changes')
    }
  })
  await assert.rejects(
    () => adminStableEmailService.acquire({
      ownerKey: 'client:70',
      ownerLabel: 'Admin Stable',
      role: 'client',
      targetClientId: 70,
      targetClientName: 'Admin Stable',
      username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
      password: 'admin-stable-pass',
      sourceEmail: 'admin-stable@example.com',
      profileIds: [7001],
      knownProfileIds: [7001]
    }),
    /Refusing to rotate admin/
  )

  const adminUserService = createDolphinLeaseService({
    targetUserId: 5166733,
    stableUsername: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    leaseMs: 1_000,
    now: () => 1,
    setTimer: (callback: () => void) => callback as any,
    clearTimer: () => {},
    listUsers: async () => [{ id: 5166733, username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL, role: 'admin' }],
    updateUser: async () => {
      throw new Error('admin user must not be patched')
    },
    removeProfileAccess: async () => {
      throw new Error('admin user must not receive profile changes')
    },
    shareProfiles: async () => {
      throw new Error('admin user must not receive profile changes')
    }
  })
  await assert.rejects(
    () => adminUserService.acquire({
      ownerKey: 'client:8',
      ownerLabel: 'Admin Email',
      role: 'client',
      targetClientId: 8,
      targetClientName: 'Admin Email',
      username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
      password: 'client-pass',
      profileIds: [801],
      knownProfileIds: [801]
    }),
    /Refusing to rotate admin/
  )

  const usernameTaken = () => {
    const error = new Error(JSON.stringify({
      text: 'You have problem in field email',
      type: 'E_TEAM',
      code: 'E_TEAM_USERNAME'
    })) as Error & { details?: any }
    error.details = {
      error: {
        text: 'You have problem in field email',
        type: 'E_TEAM',
        code: 'E_TEAM_USERNAME'
      },
      details: {
        message: 'The username has already been taken.'
      }
    }
    return error
  }
  const unavailableOperations: string[] = []
  const unavailableAuditEvents: Array<Record<string, unknown>> = []
  const unavailableService = createDolphinLeaseService({
    targetUserId: 5166733,
    stableUsername: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    leaseMs: 1_000,
    now: () => 1,
    setTimer: (callback: () => void) => callback as any,
    clearTimer: () => {},
    auditLog: (event: Record<string, unknown>) => {
      unavailableAuditEvents.push(event)
    },
    listUsers: async () => [{ id: 5166733, username: 'different-shared@example.com', role: 'user' }],
    updateUser: async () => {
      unavailableOperations.push('update')
      throw usernameTaken()
    },
    removeProfileAccess: async () => {
      unavailableOperations.push('remove')
    },
    shareProfiles: async () => {
      unavailableOperations.push('share')
    }
  })
  await assert.rejects(
    () => unavailableService.acquire({
      ownerKey: 'client:9',
      ownerLabel: 'Unavailable Stable',
      role: 'client',
      targetClientId: 9,
      targetClientName: 'Unavailable Stable',
      username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
      password: 'unavailable-pass',
      sourceEmail: 'client9@example.com',
      profileIds: [901],
      knownProfileIds: [901, 902]
    }),
    (error: any) => {
      assert.equal(error.code, 'stable_dolphin_email_unavailable')
      assert.equal(error.stableUsername, DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
      assert.equal(error.targetUserId, 5166733)
      assert.equal(error.dolphinErrorCode, 'E_TEAM_USERNAME')
      return true
    }
  )
  assert.deepEqual(unavailableOperations, ['update'])
  assert.equal(unavailableAuditEvents[0].event, 'dolphin_profile_access_lease_failed')
  assert.equal(unavailableAuditEvents[0].dolphinErrorCode, 'E_TEAM_USERNAME')

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
    stableUsername: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    leaseMs: 1_000,
    now: () => 5_000,
    setTimer: (callback: () => void) => callback as any,
    clearTimer: () => {},
    listUsers: async () => [{ id: 5166733, username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL, role: 'user' }],
    updateUser: async (_userId: number, patch: { username: string }) => {
      concurrentUpdates.push(String(patch.username))
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
    username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    password: 'first-pass',
    profileIds: [401],
    knownProfileIds: [401, 402]
  })
  const second = concurrentService.acquire({
    ownerKey: 'client:3',
    ownerLabel: 'Second',
    role: 'client',
    targetClientId: 3,
    targetClientName: 'Second',
    username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    password: 'second-pass',
    profileIds: [402],
    knownProfileIds: [401, 402]
  })
  await firstUpdateStarted
  releaseFirstUpdate()
  await first
  await assert.rejects(second, /account in use sorry/)
  assert.deepEqual(concurrentUpdates, [DEFAULT_DOLPHIN_SHARED_USER_EMAIL])
  assert.deepEqual(concurrentAccess, ['remove', 'share'])

  const failedAuditEvents: Array<Record<string, unknown>> = []
  const failedAccess: string[] = []
  const failingService = createDolphinLeaseService({
    targetUserId: 5166733,
    stableUsername: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    leaseMs: 1_000,
    now: () => 9_000,
    setTimer: (callback: () => void) => callback as any,
    clearTimer: () => {},
    auditLog: (event: Record<string, unknown>) => {
      failedAuditEvents.push(event)
    },
    listUsers: async () => [{ id: 5166733, username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL, role: 'user' }],
    removeProfileAccess: async () => {
      failedAccess.push('remove')
    },
    updateUser: async () => {
      const error = new Error(JSON.stringify({
        text: 'You have problem in field email',
        type: 'E_TEAM',
        code: 'E_TEAM_USERNAME'
      })) as Error & { details?: any }
      error.details = {
        text: 'You have problem in field email',
        type: 'E_TEAM',
        code: 'E_TEAM_USERNAME'
      }
      throw error
    },
    shareProfiles: async () => {
      failedAccess.push('share')
    }
  })
  await assert.rejects(
    () => failingService.acquire({
      ownerKey: 'client:6',
      ownerLabel: 'Numeric Email Client',
      role: 'client',
      targetClientId: 6,
      targetClientName: 'Numeric Email Client',
      username: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
      password: 'generated-pass',
      sourceEmail: '6186914@gmail.com',
      profileIds: [618691401, 618691402],
      knownProfileIds: [101, 102, 618691401, 618691402]
    }),
    /E_TEAM_USERNAME/
  )
  assert.deepEqual(failedAccess, [])
  assert.deepEqual(failedAuditEvents[0], {
    event: 'dolphin_profile_access_lease_failed',
    dryRun: false,
    dolphinUserId: 5166733,
    credentialMode: 'stable_shared_email',
    ownerKey: 'client:6',
    ownerLabel: 'Numeric Email Client',
    role: 'client',
    targetClientId: 6,
    targetClientName: 'Numeric Email Client',
    attemptedUsername: DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
    sourceEmail: '6186914@gmail.com',
    revokedProfileIds: [101, 102, 618691401, 618691402],
    grantedProfileIds: [618691401, 618691402],
    dolphinErrorCode: 'E_TEAM_USERNAME'
  })
  assert.equal(JSON.stringify(failedAuditEvents[0]).includes('generated-pass'), false)
}

runTests()
  .then(() => console.log('web console dolphin lease tests passed'))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
