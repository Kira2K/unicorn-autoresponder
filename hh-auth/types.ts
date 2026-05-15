export type HHAuthState = 'logged_in' | 'logged_out' | 'captcha' | 'unknown'

export type HHAuthErrorCode =
  | 'captcha_detected'
  | 'invalid_credentials'
  | 'missing_credentials'
  | 'selector_missing'
  | 'session_not_persisted'
  | 'auth_unknown'
  | 'login_failed'

export type HHBrowserMode = 'headless' | 'headfull'

export type HHAuthLogger = (message: string, details?: Record<string, unknown>) => void

export type HHCredentials = {
  email: string
  password: string
}

export type HHAuthResult = {
  state: HHAuthState
  checkedAt: string
  url: string
  title: string
  signals: Record<string, boolean>
}

export type HHAuthStepResult = {
  ok: boolean
  state: HHAuthState
  initialHeadless?: HHAuthResult
  headfullAfterLogin?: HHAuthResult
  finalHeadless?: HHAuthResult
  runningProfile?: StartedProfile
  usedHeadfullLogin?: boolean
}

export type ValidateAuthOptions = {
  log?: HHAuthLogger
  timeoutMs?: number
}

export type StartedProfile = {
  profileId: number
  mode: HHBrowserMode
  port: number
}

export type MakeHHAuthOptions = {
  credentials?: HHCredentials
  getCredentials?: () => Promise<HHCredentials>
  startProfile: (profileId: number, mode: HHBrowserMode) => Promise<StartedProfile>
  stopProfile: (profileId: number) => Promise<void>
  connectToProfile: (startedProfile: StartedProfile) => Promise<any>
  artifactDir?: string
  errorArtifactDir?: string
  keepProfileRunningOnSuccess?: boolean
  loginInHeadlessOnBackUrl?: boolean
  skipInitialHeadlessCheck?: boolean
  verifyPersistedSession?: boolean
  log?: HHAuthLogger
  timeoutMs?: number
}

export type AuthorizeHHPageOptions = {
  credentials?: HHCredentials
  getCredentials?: () => Promise<HHCredentials>
  artifactDir?: string
  errorArtifactDir?: string
  log?: HHAuthLogger
  timeoutMs?: number
}
