require('dotenv').config({ quiet: true })

type NocoConfig = {
  baseUrl: string
  token: string
  baseId: string
}

function getNocoConfig(): NocoConfig {
  const token = process.env.nocodb_api_token || process.env.NOCODB_API_TOKEN
  if (!token) {
    throw new Error('Missing nocodb_api_token in environment')
  }

  return {
    baseUrl: (
      process.env.NOCODB_BASE_URL ||
      process.env.nocodb_base_url ||
      'https://app.nocodb.com'
    ).replace(/\/+$/, ''),
    token,
    baseId: process.env.NOCODB_BASE_ID || 'pqe5susktrsa9z3'
  }
}

function nocoHeaders(config = getNocoConfig()): Record<string, string> {
  return {
    'xc-token': config.token,
    'Content-Type': 'application/json'
  }
}

module.exports = {
  getNocoConfig,
  nocoHeaders
}
