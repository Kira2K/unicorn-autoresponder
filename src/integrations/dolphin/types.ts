export type DolphinStartResponse = {
  success?: boolean
  automation?: {
    port?: number
    wsEndpoint?: string
  }
  error?: string
  errorObject?: {
    code?: string
    text?: string
  }
}

export type DolphinBrowserProfile = {
  id: number | string
  tags?: string[]
  status?: DolphinProfileStatus | null
}

export type DolphinProfileResponse = {
  data?: DolphinBrowserProfile
}

export type DolphinProfileStatus = {
  id?: number | string
  name?: string
  color?: string
  deleted?: number
}

export type DolphinProfileStatusResponse = {
  data?: DolphinProfileStatus
}

export type DolphinProfileStatusListResponse = {
  data?: DolphinProfileStatus[]
}
