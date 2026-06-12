function describeError(error: any): string {
  const data = error?.response?.data
  const message =
    data?.message ??
    data?.msg ??
    data?.error ??
    error?.message ??
    error ??
    'Unknown error'

  if (typeof message === 'string') {
    return message
  }

  try {
    return JSON.stringify(message)
  } catch {
    return String(message)
  }
}

function describeDetailedError(error: any): Record<string, unknown> {
  return {
    status: error?.response?.status,
    statusText: error?.response?.statusText,
    code: error?.code,
    message: describeError(error),
    data: error?.response?.data,
    url: error?.config?.url,
    method: error?.config?.method
  }
}

module.exports = {
  describeDetailedError,
  describeError
}
