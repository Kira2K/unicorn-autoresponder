import { nocoErrorCode } from '../../../integrations/noco/core/error-policy.ts'

export function nocoRouteFailure(error: any) {
  const code = nocoErrorCode(error)
  if (!code) return undefined
  return {
    status: code === 'noco_rate_limited' ? 429 : 503,
    body: {
      error: code,
      message: code === 'noco_rate_limited'
        ? 'NocoDB is busy. Wait and retry.'
        : 'NocoDB is temporarily unavailable. Wait and retry.'
    }
  }
}
