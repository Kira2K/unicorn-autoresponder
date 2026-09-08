import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startStandalone } from '../standalone.ts'

test('standalone serves built assets inside a hidden parent directory', async () => {
  const original = process.cwd()
  const temporary = await mkdtemp(join(tmpdir(), 'post-assets-'))
  const project = join(temporary, '.hidden', 'project')
  const assets = join(project, 'dist', 'web-console')
  await mkdir(assets, { recursive: true })
  await writeFile(join(assets, 'writer.html'), '<h1>Writer fixture</h1>')
  let service: Awaited<ReturnType<typeof startStandalone>> | undefined
  try {
    process.chdir(project)
    service = await startStandalone({ LINKEDIN_POST_TEXT_ENABLED: 'false',
      LINKEDIN_POST_TEXT_TOKEN: 'mock-token-for-assets-test-only', LINKEDIN_POST_TEXT_PORT: '0' })
    const port = (service.server.address() as { port: number }).port
    const response = await fetch('http://127.0.0.1:' + port + '/')
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Writer fixture/)
    assert.equal((await fetch('http://127.0.0.1:' + port + '/api/post-writer/text')).status, 401)
  } finally {
    await service?.close()
    process.chdir(original)
    await rm(temporary, { recursive: true, force: true })
  }
})
