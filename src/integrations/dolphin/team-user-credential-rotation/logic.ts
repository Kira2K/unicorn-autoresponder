const assert = require('node:assert/strict')

type TeamUserRole = 'admin' | 'teamlead' | 'user' | string

type TeamUser = {
  id: number
  username: string
  role: TeamUserRole
}

type RotationStep = {
  email: string
  password: string
}

type RotationOptions = {
  targetUserId: number
  restoreEmail: string
  steps: RotationStep[]
  intervalMs: number
  listUsers: () => Promise<TeamUser[]>
  updateUser: (userId: number, patch: { username: string; password: string }) => Promise<unknown>
  wait: (ms: number) => Promise<void>
  prompt: (question: string) => Promise<string>
  log: (message: string) => void
  onApplied?: (credential: AppliedCredential) => void
}

type AppliedCredential = {
  email: string
  password: string
}

const DEFAULT_TARGET_USER_ID = 5131904
const DEFAULT_RESTORE_EMAIL = 'neurocorn.theveryevil@gmail.com'
const DEFAULT_INTERVAL_MS = 60_000
const DEFAULT_ROTATION_STEPS: RotationStep[] = [
  { email: 'judoshark@gmail.com', password: 'aaaaaaaa' },
  { email: 'nospanov9@gmail.com', password: 'bbbbbbbb' },
  { email: 'charlie2kfox@gmail.com', password: 'cccccccc' }
]

function validateTargetUser(users: TeamUser[], targetUserId: number, expectedEmail: string): TeamUser {
  const user = users.find(item => Number(item.id) === targetUserId)

  if (!user) {
    throw new Error(`Dolphin team user ${targetUserId} was not found.`)
  }

  if (user.role === 'admin') {
    throw new Error(`Refusing to rotate admin Dolphin user ${user.username} (${user.id}).`)
  }

  if (user.username !== expectedEmail) {
    throw new Error(
      `Refusing to start: Dolphin user ${targetUserId} email is ${user.username}, expected ${expectedEmail}.`
    )
  }

  return user
}

function formatCredentialLine(step: RotationStep): string {
  return `It's time for email ${step.email} and the pass is ${step.password}`
}

async function runCredentialRotation(options: RotationOptions): Promise<AppliedCredential | null> {
  const users = await options.listUsers()
  const user = validateTargetUser(users, options.targetUserId, options.restoreEmail)

  options.log(`Target Dolphin user: ${user.username} (${user.id}), role=${user.role}`)
  options.log(`Restore email after test: ${options.restoreEmail}`)
  options.log('Type YES to start rotating Dolphin login email/password.')

  const confirmation = (await options.prompt('Start rotation? Type YES: ')).trim()
  if (confirmation !== 'YES') {
    options.log('Rotation cancelled.')
    return null
  }

  let lastApplied: AppliedCredential | null = null

  for (let index = 0; index < options.steps.length; index += 1) {
    const step = options.steps[index]

    options.log(formatCredentialLine(step))
    await options.updateUser(options.targetUserId, {
      username: step.email,
      password: step.password
    })
    lastApplied = { email: step.email, password: step.password }
    options.onApplied?.(lastApplied)
    options.log(`Applied email ${step.email} with pass ${step.password}`)

    if (index < options.steps.length - 1) {
      options.log(`Waiting ${Math.round(options.intervalMs / 1000)} seconds before next switch...`)
      await options.wait(options.intervalMs)
    }
  }

  options.log(`Rotation steps are done. Restore email is ${options.restoreEmail}.`)
  const restorePassword = await options.prompt(`Enter password to restore ${options.restoreEmail}: `)
  const trimmedRestorePassword = restorePassword.trim()

  if (!trimmedRestorePassword) {
    throw new Error(`Restore password is empty. Last applied email=${lastApplied?.email}, pass=${lastApplied?.password}.`)
  }

  await options.updateUser(options.targetUserId, {
    username: options.restoreEmail,
    password: trimmedRestorePassword
  })
  options.log(`Restored email ${options.restoreEmail} with pass ${trimmedRestorePassword}`)

  return lastApplied
}

async function runTests(): Promise<void> {
  const calls: Array<{ userId: number; username: string; password: string }> = []
  const logs: string[] = []
  const prompts: string[] = []
  const waits: number[] = []
  const users = [{ id: 5131904, username: DEFAULT_RESTORE_EMAIL, role: 'teamlead' }]

  await runCredentialRotation({
    targetUserId: DEFAULT_TARGET_USER_ID,
    restoreEmail: DEFAULT_RESTORE_EMAIL,
    steps: DEFAULT_ROTATION_STEPS,
    intervalMs: 12,
    listUsers: async () => users,
    updateUser: async (userId, patch) => {
      calls.push({ userId, username: patch.username, password: patch.password })
    },
    wait: async ms => {
      waits.push(ms)
    },
    prompt: async question => {
      prompts.push(question)
      return prompts.length === 1 ? 'YES' : 'restorepass'
    },
    log: message => logs.push(message),
    onApplied: credential => {
      assert.equal(credential.email, calls[calls.length - 1].username)
      assert.equal(credential.password, calls[calls.length - 1].password)
    }
  })

  assert.deepEqual(
    calls.map(call => [call.username, call.password]),
    [
      ['judoshark@gmail.com', 'aaaaaaaa'],
      ['nospanov9@gmail.com', 'bbbbbbbb'],
      ['charlie2kfox@gmail.com', 'cccccccc'],
      [DEFAULT_RESTORE_EMAIL, 'restorepass']
    ]
  )
  assert.deepEqual(waits, [12, 12])
  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /Enter password to restore neurocorn\.theveryevil@gmail\.com/)
  assert(logs.includes("It's time for email judoshark@gmail.com and the pass is aaaaaaaa"))
  assert(logs.includes("It's time for email nospanov9@gmail.com and the pass is bbbbbbbb"))
  assert(logs.includes("It's time for email charlie2kfox@gmail.com and the pass is cccccccc"))

  assert.throws(
    () => validateTargetUser([{ id: 1, username: 'admin@example.com', role: 'admin' }], 1, 'admin@example.com'),
    /Refusing to rotate admin/
  )
  assert.throws(
    () => validateTargetUser([{ id: 2, username: 'changed@example.com', role: 'teamlead' }], 2, 'old@example.com'),
    /expected old@example\.com/
  )
  assert.throws(() => validateTargetUser([], 3, 'missing@example.com'), /was not found/)
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_RESTORE_EMAIL,
  DEFAULT_ROTATION_STEPS,
  DEFAULT_TARGET_USER_ID,
  formatCredentialLine,
  runCredentialRotation,
  runTests,
  validateTargetUser
}
