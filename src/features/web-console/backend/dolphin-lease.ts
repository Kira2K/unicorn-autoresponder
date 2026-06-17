type UserRole = import('./types.ts').UserRole

type TeamUser = {
  id: number
  username: string
  role: string
}

type DolphinCredentialMode = 'stable_shared_email'

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
  dolphinUserId: number
  credentialMode: DolphinCredentialMode
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
  dolphinUserId: number
  credentialMode: DolphinCredentialMode
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

type LeaseAttemptContext = {
  dryRun: boolean
  dolphinUserId: number
  credentialMode: DolphinCredentialMode
  ownerKey: string
  ownerLabel: string
  role: Exclude<UserRole, 'admin'>
  targetClientId: number
  targetClientName: string
  attemptedUsername: string
  sourceEmail?: string
  revokedProfileIds: number[]
  grantedProfileIds: number[]
}

type LeaseConflict = Error & {
  code: 'account_in_use'
  activeUntil: number
  ownerLabel: string
}

type StableDolphinEmailUnavailable = Error & {
  code: 'stable_dolphin_email_unavailable'
  stableUsername: string
  targetUserId: number
  dolphinErrorCode?: string
  dolphinError?: unknown
}

type DolphinLeaseServiceOptions = {
  targetUserId: number
  stableUsername: string
  leaseMs: number
  dryRun?: boolean
  auditLog?: (event: Record<string, unknown>) => void
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout
  clearTimer?: (timer: NodeJS.Timeout) => void
  listUsers?: () => Promise<TeamUser[]>
  updateUser?: (userId: number, patch: { username: string; password: string; displayName?: string }) => Promise<unknown>
  shareProfiles?: (profileIds: number[], userId: number) => Promise<unknown>
  removeProfileAccess?: (profileIds: number[], userId: number) => Promise<unknown>
}

const DEFAULT_DOLPHIN_SHARED_USER_ID = 5166733
const DEFAULT_DOLPHIN_SHARED_USER_EMAIL = 'kind.cute.unicorn@gmail.com'
const DEFAULT_DOLPHIN_SHARED_USER_LEASE_MS = 120_000

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function parseMaybeJson(value: unknown): any {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseDolphinErrorDetails(error: unknown): any {
  const details = (error as any)?.details
  if (details && typeof details === 'object') return details
  const message = error instanceof Error ? error.message : String(error)
  const parsed = parseMaybeJson(message)
  return parsed && typeof parsed === 'object' ? parsed : null
}

function normalizeDolphinErrorDetails(error: unknown): any {
  const details = parseMaybeJson(parseDolphinErrorDetails(error))
  const candidates = [
    details,
    parseMaybeJson(details?.message),
    parseMaybeJson(details?.error),
    parseMaybeJson(details?.data),
    parseMaybeJson(details?.errors)
  ].filter(Boolean)
  return candidates.find(candidate => typeof candidate === 'object' && candidate.code) ?? details
}

function dolphinErrorCode(error: unknown): string | undefined {
  return normalizeDolphinErrorDetails(error)?.code
}

function isDolphinUsernameTakenError(error: unknown): boolean {
  return dolphinErrorCode(error) === 'E_TEAM_USERNAME'
}

function buildLeaseAttemptContext(
  request: LeaseRequest,
  dryRun: boolean,
  dolphinUserId: number,
  credentialMode: DolphinCredentialMode,
  profilesRevoked: number[],
  profilesGranted: number[]
): LeaseAttemptContext {
  return {
    dryRun,
    dolphinUserId,
    credentialMode,
    ownerKey: request.ownerKey,
    ownerLabel: request.ownerLabel,
    role: request.role,
    targetClientId: request.targetClientId,
    targetClientName: request.targetClientName,
    attemptedUsername: request.username,
    sourceEmail: request.sourceEmail,
    revokedProfileIds: profilesRevoked,
    grantedProfileIds: profilesGranted
  }
}

function publicLease(lease: DolphinLease): PublicDolphinLease {
  return {
    ok: true,
    dolphinUserId: lease.dolphinUserId,
    credentialMode: lease.credentialMode,
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

function findTeamUserByEmail(users: TeamUser[], email: string): TeamUser | undefined {
  const normalized = normalizeEmail(email)
  return users.find(user => normalizeEmail(user.username) === normalized)
}

function createStableDolphinEmailUnavailable(
  stableUsername: string,
  targetUserId: number,
  error: unknown
): StableDolphinEmailUnavailable {
  const created = new Error(
    `Stable Dolphin login ${stableUsername} is not available in Dolphin. Choose another stable email or free this email in Dolphin.`
  ) as StableDolphinEmailUnavailable
  created.code = 'stable_dolphin_email_unavailable'
  created.stableUsername = stableUsername
  created.targetUserId = targetUserId
  created.dolphinErrorCode = dolphinErrorCode(error)
  created.dolphinError = normalizeDolphinErrorDetails(error)
  return created
}

function createDolphinLeaseService(options: DolphinLeaseServiceOptions) {
  let activeLease: DolphinLease | null = null
  let inFlight: Promise<PublicDolphinLease> | null = null
  const now = options.now ?? (() => Date.now())
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = options.clearTimer ?? (timer => clearTimeout(timer))
  const dryRun = Boolean(options.dryRun)
  const stableUsername = normalizeEmail(options.stableUsername)
  const credentialMode: DolphinCredentialMode = 'stable_shared_email'
  const auditLog = options.auditLog ?? ((event: Record<string, unknown>) => {
    console.log(`Dolphin lease access: ${JSON.stringify(event)}`)
  })
  const dolphinApi = () => require('../../../integrations/dolphin/team-users.ts') as {
    listTeamUsers(): Promise<TeamUser[]>
    updateTeamUserCredentials(userId: number, patch: { username: string; password: string; displayName?: string }): Promise<unknown>
  }
  const profileAccessApi = () => require('../../../integrations/dolphin/profile-access.ts') as {
    shareBrowserProfiles(profileIds: number[], userId: number): Promise<unknown>
    removeBrowserProfilesAccess(profileIds: number[], userId: number): Promise<unknown>
  }
  const listUsersImpl = options.listUsers ?? (
    dryRun
      ? async () => [{ id: options.targetUserId, username: stableUsername, role: 'teamlead' }]
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
      const profilesRevoked = [...new Set(request.knownProfileIds)]
      const profilesGranted = [...new Set(request.profileIds)]
      const displayName = `Shared for ${request.targetClientName}`.slice(0, 120)
      let dolphinUserId = options.targetUserId

      try {
        const stableUser = findTeamUserByEmail(users, stableUsername)
        if (stableUser) {
          dolphinUserId = stableUser.id
          validateDolphinTargetUser(users, dolphinUserId)
          await updateUserImpl(dolphinUserId, {
            username: stableUsername,
            password: request.password,
            displayName
          })
        } else {
          const targetUser = validateDolphinTargetUser(users, options.targetUserId)
          dolphinUserId = targetUser.id
          try {
            await updateUserImpl(dolphinUserId, {
              username: stableUsername,
              password: request.password,
              displayName
            })
          } catch (error: unknown) {
            if (isDolphinUsernameTakenError(error)) {
              throw createStableDolphinEmailUnavailable(stableUsername, options.targetUserId, error)
            }
            throw error
          }
        }
        await removeProfileAccessImpl(profilesRevoked, dolphinUserId)
        await shareProfilesImpl(profilesGranted, dolphinUserId)
        auditLog({
          event: 'dolphin_profile_access_lease_applied',
          ...buildLeaseAttemptContext(
            { ...request, username: stableUsername },
            dryRun,
            dolphinUserId,
            credentialMode,
            profilesRevoked,
            profilesGranted
          )
        })
      } catch (error: unknown) {
        auditLog({
          event: 'dolphin_profile_access_lease_failed',
          ...buildLeaseAttemptContext(
            { ...request, username: stableUsername },
            dryRun,
            dolphinUserId,
            credentialMode,
            profilesRevoked,
            profilesGranted
          ),
          dolphinErrorCode: (error as any)?.dolphinErrorCode ?? dolphinErrorCode(error)
        })
        throw error
      }

      const expiresAt = now() + options.leaseMs
      const lease: DolphinLease = {
        ownerKey: request.ownerKey,
        ownerLabel: request.ownerLabel,
        role: request.role,
        targetClientName: request.targetClientName,
        dolphinUserId,
        credentialMode,
        username: stableUsername,
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
    targetUserId: resolveDolphinSharedUserId(),
    stableUsername: resolveDolphinSharedUserEmail(),
    leaseMs: Number(process.env.DOLPHIN_SHARED_USER_LEASE_MS ?? DEFAULT_DOLPHIN_SHARED_USER_LEASE_MS),
    dryRun: process.env.WEB_CONSOLE_DOLPHIN_LEASE_DRY_RUN === 'true'
  })
}

function resolveDolphinSharedUserId(): number {
  return Number(process.env.DOLPHIN_SHARED_USER_ID ?? DEFAULT_DOLPHIN_SHARED_USER_ID)
}

function resolveDolphinSharedUserEmail(): string {
  return normalizeEmail(process.env.DOLPHIN_SHARED_USER_EMAIL ?? DEFAULT_DOLPHIN_SHARED_USER_EMAIL)
}

module.exports = {
  DEFAULT_DOLPHIN_SHARED_USER_EMAIL,
  DEFAULT_DOLPHIN_SHARED_USER_ID,
  DEFAULT_DOLPHIN_SHARED_USER_LEASE_MS,
  buildLeaseAttemptContext,
  createDefaultDolphinLeaseService,
  createDolphinLeaseService,
  dolphinErrorCode,
  isLeaseActive,
  isDolphinUsernameTakenError,
  createStableDolphinEmailUnavailable,
  normalizeDolphinErrorDetails,
  publicLease,
  resolveDolphinSharedUserEmail,
  resolveDolphinSharedUserId,
  validateDolphinTargetUser
}
