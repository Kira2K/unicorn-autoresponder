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
