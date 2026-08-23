const assert = require('node:assert/strict')
const { updateLinkedInUrl } = require('../noco-account-update.ts') as {
  updateLinkedInUrl(client: any, id: number, value: unknown): Promise<string>
}

async function run(): Promise<void> {
  const patches: any[] = []
  const client = {
    async patchRecord(tableId: string, id: number, patch: any) {
      patches.push({ tableId, id, patch })
    }
  }
  const url = await updateLinkedInUrl(client, 105, 'https://linkedin.com/in/Diana-Kuanyshkyzy')
  assert.equal(url, 'https://www.linkedin.com/in/diana-kuanyshkyzy/')
  assert.equal(patches[0].id, 105)
  assert.deepEqual(patches[0].patch, { url })
  await assert.rejects(
    updateLinkedInUrl(client, 105, 'https://example.com/diana'),
    (error: any) => error.code === 'linkedin_url_invalid'
  )
}

module.exports = { run }
