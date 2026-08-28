export function retryableUnipileRead(error: any): boolean {
  const code = String(error?.code ?? '')
  const status = Number(error?.details?.httpStatus)
  return ['unipile_timeout', 'unipile_unreachable', 'unipile_rate_limit'].includes(code) ||
    status === 429 || status >= 500
}
