type UserRole = import('./types.ts').UserRole

type TeamUser = {
  id: number
  username: string
  role: string
}

type LeaseRequest = {
  ownerKey: string
  ownerLabel: string
  role: Exclude<UserRole, 'admin'>
  targetClientId: number
  targetClientName: string
  username: string
  password: string
  sourceEmail?: string
  profileIds: number[]
  knownProfileIds: number[]
}

type DolphinLease = {
  ownerKey: string
  ownerLabel: string
  role: Exclude<UserRole, 'admin'>
  targetClientName: string
  username: string
  password: string
  sourceEmail?: string
  profileIds: number[]
  profilesGranted: number[]
  profilesRevoked: number[]
  expiresAt: number
  leaseMs: number
  timer?: NodeJS.Timeout
}

type PublicDolphinLease = {
  ok: true
  username: string
  password: string
  sourceEmail?: string
  profileIds: number[]
  profilesGranted: number[]
  profilesRevoked: number[]
  expiresAt: number
  leaseMs: number
  ownerLabel: string
  targetClientName: string
}

type LeaseConflict = Error & {
  code: 'account_in_use'
  activeUntil: number
  ownerLabel: string
}

type DolphinLeaseServiceOptions = {
  targetUserId: number
  leaseMs: number
  dryRun?: boolean
  auditLog?: (event: Record<string, unknown>) => void
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout
  clearTimer?: (timer: NodeJS.Timeout) => void
  listUsers?: () => Promise<TeamUser[]>
  updateUser?: (userId: number, patch: { username: string; password: string }) => Promise<unknown>
  shareProfiles?: (profileIds: number[], userId: number) => Promise<unknown>
  removeProfileAccess?: (profileIds: number[], userId: number) => Promise<unknown>
}

const DEFAULT_DOLPHIN_SHARED_USER_ID = 5166733
const DEFAULT_DOLPHIN_SHARED_USER_LEASE_MS = 120_000
const PROVIDER_DOLPHIN_EMAIL = 'nospanov9@gmail.com'

function publicLease(lease: DolphinLease): PublicDolphinLease {
  return {
    ok: true,
    username: lease.username,
    password: lease.password,
    sourceEmail: lease.sourceEmail,
    profileIds: lease.profileIds,
    profilesGranted: lease.profilesGranted,
    profilesRevoked: lease.profilesRevoked,
    expiresAt: lease.expiresAt,
    leaseMs: lease.leaseMs,
    ownerLabel: lease.ownerLabel,
    targetClientName: lease.targetClientName
  }
}

function isLeaseActive(lease: DolphinLease | null, now: number): lease is DolphinLease {
  return Boolean(lease && lease.expiresAt > now)
}

function createLeaseConflict(lease: DolphinLease): LeaseConflict {
  const error = new Error('account in use sorry') as LeaseConflict
  error.code = 'account_in_use'
  error.activeUntil = lease.expiresAt
  error.ownerLabel = lease.ownerLabel
  return error
}

function validateDolphinTargetUser(users: TeamUser[], targetUserId: number): TeamUser {
  const user = users.find(item => Number(item.id) === Number(targetUserId))
  if (!user) throw new Error(`Dolphin team user ${targetUserId} was not found.`)
  if (user.role === 'admin') throw new Error(`Refusing to rotate admin Dolphin user ${user.username} (${user.id}).`)
  return user
}

function createDolphinLeaseService(options: DolphinLeaseServiceOptions) {
  let activeLease: DolphinLease | null = null
  let inFlight: Promise<PublicDolphinLease> | null = null
  const now = options.now ?? (() => Date.now())
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = options.clearTimer ?? (timer => clearTimeout(timer))
  const dryRun = Boolean(options.dryRun)
  const auditLog = options.auditLog ?? ((event: Record<string, unknown>) => {
    console.log(`Dolphin lease access: ${JSON.stringify(event)}`)
  })
  const dolphinApi = () => require('../../../integrations/dolphin/team-user-credential-rotation/index.ts') as {
    listTeamUsers(): Promise<TeamUser[]>
    updateTeamUserCredentials(userId: number, patch: { username: string; password: string }): Promise<unknown>
  }
  const profileAccessApi = () => require('../../../integrations/dolphin/profile-access.ts') as {
    shareBrowserProfiles(profileIds: number[], userId: number): Promise<unknown>
    removeBrowserProfilesAccess(profileIds: number[], userId: number): Promise<unknown>
  }
  const listUsersImpl = options.listUsers ?? (
    dryRun
      ? async () => [{ id: options.targetUserId, username: 'dry-run@example.com', role: 'teamlead' }]
      : () => dolphinApi().listTeamUsers()
  )
  const updateUserImpl = options.updateUser ?? (
    dryRun
      ? async () => ({ ok: true, dryRun: true })
      : (userId, patch) => dolphinApi().updateTeamUserCredentials(userId, patch)
  )
  const shareProfilesImpl = options.shareProfiles ?? (
    dryRun
      ? async () => ({ ok: true, dryRun: true })
      : (profileIds, userId) => profileAccessApi().shareBrowserProfiles(profileIds, userId)
  )
  const removeProfileAccessImpl = options.removeProfileAccess ?? (
    dryRun
      ? async () => ({ ok: true, dryRun: true })
      : (profileIds, userId) => profileAccessApi().removeBrowserProfilesAccess(profileIds, userId)
  )

  function clearLease(): void {
    if (activeLease?.timer) clearTimer(activeLease.timer)
    activeLease = null
  }

  async function acquire(request: LeaseRequest): Promise<PublicDolphinLease> {
    const currentTime = now()
    if (isLeaseActive(activeLease, currentTime)) {
      if (activeLease.ownerKey === request.ownerKey) return publicLease(activeLease)
      throw createLeaseConflict(activeLease)
    }
    clearLease()

    if (inFlight) {
      await inFlight
      return await acquire(request)
    }

    inFlight = (async () => {
      const users = await listUsersImpl()
      validateDolphinTargetUser(users, options.targetUserId)
      const profilesRevoked = [...new Set(request.knownProfileIds)]
      const profilesGranted = [...new Set(request.profileIds)]
      await removeProfileAccessImpl(profilesRevoked, options.targetUserId)
      await updateUserImpl(options.targetUserId, {
        username: request.username,
        password: request.password
      })
      await shareProfilesImpl(profilesGranted, options.targetUserId)
      auditLog({
        event: 'dolphin_profile_access_lease_applied',
        dryRun,
        sharedUserId: options.targetUserId,
        ownerKey: request.ownerKey,
        ownerLabel: request.ownerLabel,
        role: request.role,
        targetClientId: request.targetClientId,
        targetClientName: request.targetClientName,
        revokedProfileIds: profilesRevoked,
        grantedProfileIds: profilesGranted
      })

      const expiresAt = now() + options.leaseMs
      const lease: DolphinLease = {
        ownerKey: request.ownerKey,
        ownerLabel: request.ownerLabel,
        role: request.role,
        targetClientName: request.targetClientName,
        username: request.username,
        password: request.password,
        sourceEmail: request.sourceEmail,
        profileIds: profilesGranted,
        profilesGranted,
        profilesRevoked,
        expiresAt,
        leaseMs: options.leaseMs
      }
      lease.timer = setTimer(() => {
        if (activeLease?.ownerKey === lease.ownerKey && activeLease.expiresAt === lease.expiresAt) {
          activeLease = null
        }
      }, options.leaseMs)
      activeLease = lease
      return publicLease(lease)
    })()

    try {
      return await inFlight
    } finally {
      inFlight = null
    }
  }

  return {
    acquire,
    clearLease,
    getActiveLease: () => activeLease ? publicLease(activeLease) : null
  }
}

function createDefaultDolphinLeaseService() {
  return createDolphinLeaseService({
    targetUserId: Number(process.env.DOLPHIN_SHARED_USER_ID ?? DEFAULT_DOLPHIN_SHARED_USER_ID),
    leaseMs: Number(process.env.DOLPHIN_SHARED_USER_LEASE_MS ?? DEFAULT_DOLPHIN_SHARED_USER_LEASE_MS),
    dryRun: process.env.WEB_CONSOLE_DOLPHIN_LEASE_DRY_RUN === 'true'
  })
}

module.exports = {
  DEFAULT_DOLPHIN_SHARED_USER_ID,
  DEFAULT_DOLPHIN_SHARED_USER_LEASE_MS,
  PROVIDER_DOLPHIN_EMAIL,
  createDefaultDolphinLeaseService,
  createDolphinLeaseService,
  isLeaseActive,
  publicLease,
  validateDolphinTargetUser
}
