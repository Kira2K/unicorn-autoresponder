const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function createTempDir(prefix = 'noco-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function createMockRequester(responses: Array<unknown | Error>) {
  const calls: Array<Record<string, unknown>> = []
  let index = 0

  async function requester(request: Record<string, unknown>): Promise<{ data: unknown }> {
    calls.push(request)
    const response = responses[index]
    index += 1
    if (response instanceof Error) {
      throw response
    }
    return { data: response }
  }

  return { calls, requester }
}

module.exports = {
  createMockRequester,
  createTempDir
}
