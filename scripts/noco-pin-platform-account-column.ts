const path = require('node:path')
const axios = require('axios')
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), silent: true })

const BASE_URL = (
  process.env.NOCODB_BASE_URL ||
  process.env.nocodb_base_url ||
  'https://app.nocodb.com'
).replace(/\/+$/, '')
const TOKEN = process.env.NOCODB_API_TOKEN || process.env.nocodb_api_token

if (!TOKEN) {
  console.error('Missing NocoDB API token. Set NOCODB_API_TOKEN or nocodb_api_token in .env or environment.')
  process.exit(1)
}

async function patchColumnMeta(columnId, meta) {
  const endpoint = `${BASE_URL}/api/v2/meta/columns/${columnId}`
  const payload = { meta }

  console.log(`Patching column ${columnId} with`, JSON.stringify(payload, null, 2))

  const response = await axios.patch(endpoint, payload, {
    headers: {
      'xc-token': TOKEN,
      'Content-Type': 'application/json'
    },
    timeout: 60000
  })

  return response.data
}

async function run() {
  try {
    await patchColumnMeta('c80ognlxq7uvsfd', {
      defaultViewColOrder: 1,
      defaultViewColVisibility: true
    })

    await patchColumnMeta('ckgsf14mcxpuhu4', {
      defaultViewColOrder: 2,
      defaultViewColVisibility: false
    })

    console.log('Done: pinned c80ognlxq7uvsfd left and hid account_label.')
  } catch (error) {
    console.error('Failed to patch NocoDB metadata:', error?.response?.data ?? error.message ?? error)
    process.exit(1)
  }
}

run()
