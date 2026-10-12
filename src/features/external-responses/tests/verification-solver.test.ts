import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTwoCaptchaDragSolver } from '../applications/verification-solver.ts'

test('DragAndDropTask sends only scoped assets and consumes create intent once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verification-solver-'))
  const calls: any[] = []
  const fetchMock: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return { ok: true, json: async () => calls.length === 1 ? { errorId: 0, taskId: 123 } : { errorId: 0, status: 'ready', solution: { coordinates: [{ x: 70, y: 80 }] } } } as Response
  }
  const assets: any = { source: 'provider_dom', background: Buffer.from('background-only'), images: [{ bytes: Buffer.from('piece-only'), from: { x: 10, y: 20 } }], instruction: 'Drag the letter to the place where it fits' }
  try {
    const disabled = createTwoCaptchaDragSolver({ enabled: false, key: 'secret', intentDirectory: directory, fetch: fetchMock })
    await assert.rejects(disabled.solve(assets, 'disabled'), /not_enabled/)
    const missing = createTwoCaptchaDragSolver({ enabled: true, intentDirectory: directory, fetch: fetchMock })
    await assert.rejects(missing.solve(assets, 'missing'), /key_missing/)
    assert.equal(calls.length, 0)
    const solver = createTwoCaptchaDragSolver({ enabled: true, key: 'secret', intentDirectory: directory, fetch: fetchMock, wait: async () => {} })
    assert.deepEqual(await solver.solve(assets, 'snapshot-1'), { coordinates: [{ x: 70, y: 80 }] })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].body.task.type, 'DragAndDropTask')
    assert.equal(calls[0].body.task.background, assets.background.toString('base64'))
    assert.deepEqual(calls[0].body.task.images, [assets.images[0].bytes.toString('base64')])
    await assert.rejects(solver.solve(assets, 'snapshot-1'), /intent_consumed/)
    assert.equal(calls.length, 2)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('provider create loss, deadline, and malformed coordinates never create a second task', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verification-solver-fail-'))
  const assets: any = { source: 'provider_dom', background: Buffer.from('background'), images: [{ bytes: Buffer.from('piece'), from: { x: 1, y: 1 } }], instruction: 'Drag the letter' }
  try {
    let calls = 0
    const lost = createTwoCaptchaDragSolver({ enabled: true, key: 'secret', intentDirectory: directory, fetch: (async () => { calls++; throw Error('network_lost') }) as typeof fetch })
    await assert.rejects(lost.solve(assets, 'lost'), /network_lost/)
    await assert.rejects(lost.solve(assets, 'lost'), /intent_consumed/)
    assert.equal(calls, 1)
    let time = 0, creates = 0
    const deadline = createTwoCaptchaDragSolver({ enabled: true, key: 'secret', intentDirectory: directory, now: () => time, wait: async ms => { time += ms },
      fetch: (async (url) => { if (String(url).endsWith('createTask')) { creates++; return { ok: true, json: async () => ({ errorId: 0, taskId: 42 }) } as Response }
        return { ok: true, json: async () => ({ errorId: 0, status: 'processing' }) } as Response }) as typeof fetch })
    await assert.rejects(deadline.solve(assets, 'deadline'), /provider_timeout/)
    assert.equal(creates, 1); assert.ok(time <= 45_000)
    const malformed = createTwoCaptchaDragSolver({ enabled: true, key: 'secret', intentDirectory: directory, wait: async () => {}, fetch: (async url => ({ ok: true, json: async () => String(url).endsWith('createTask') ? { errorId: 0, taskId: 99 } : { errorId: 0, status: 'ready', solution: { coordinates: [{ x: 'wrong', y: 1 }] } } }) as Response) as typeof fetch })
    await assert.rejects(malformed.solve(assets, 'malformed'), /solution_invalid/)
    await assert.rejects(malformed.solve(assets, '../escape'), /Invalid identifier/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
