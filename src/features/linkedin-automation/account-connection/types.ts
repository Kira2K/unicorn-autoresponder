export type SupportedProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5'

export type LinkedInProxy = {
  host: string
  port: number
  protocol: SupportedProxyProtocol
  username?: string
  password?: string
}

export type LinkedInSessionSnapshot = {
  liAt: string
  userAgent: string
  profileUrl: string
  publicIdentifier: string
}

export type LinkedInAuthTarget = {
  clientId: number
  clientName: string
  dolphinProfileId: number
  platformAccountId: number
  expectedLinkedInUrl: string
  unipileAccountId?: string
  unipileAccountStatus?: string
  verifiedProviderId?: string
}

export type LinkedInAuthAccountRow = {
  platformAccountId: number
  clientId: number
  clientName: string
  primaryStackId?: number
  primaryStack?: string
  linkedinUrl: string
  dolphinProfileId?: number
  readinessErrorCode?: string
  unipileAccountId?: string
  unipileAccountStatus?: string
  verifiedProfileUrl?: string
  verifiedProviderId?: string
  verifiedProfileName?: string
  lastVerifiedAt?: string
  authErrorCode?: string
  authUpdatedAt?: string
}

export type UnipileAccount = {
  object?: string
  id: string
  user_id?: string
  name?: string
  provider: string
  status: 'running' | 'disconnected' | 'errored' | 'partial' | 'degraded' | string
  is_locked: boolean
  metadata?: {
    products_connection_status?: Record<string, string>
  }
}

export type UnipileOwnProfile = Record<string, unknown> & {
  id?: string
  provider_id?: string
  public_identifier?: string
  public_profile_url?: string
  profile_url?: string
  name?: string
  first_name?: string
  last_name?: string
}

export type AuthenticationCheckpoint = {
  object: 'AuthenticationCheckpoint'
  intent_id?: string
  checkpoint?: {
    type?: string
  }
}

export type UnipileAuthIntentResult = UnipileAccount | AuthenticationCheckpoint

export type LinkedInAuthDependencies = {
  repository: any
  adapter: any
  collectSession(
    profileId: number,
    expectedUrl: string,
    logger?: import('./auth-logger.ts').AuthLogger
  ): Promise<any>
  inspectProfile(profileId: number): Promise<any>
  logger?: import('./auth-logger.ts').AuthLogger
  unipileProxyProtocol?(proxy: LinkedInProxy): SupportedProxyProtocol
}
