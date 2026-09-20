import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnectionInviterService } from '../connection-inviter/service.ts'
import { fixture as inviterFixture } from '../connection-inviter/tests/fixtures.ts'
import { fixture } from './test-fixture.ts'
test('withdrawal shares writer permissions, allowed accounts and account gate with Inviter', async () => {
  const f = fixture(), inviter = inviterFixture({ stack: 'Frontend' })
  const options = { ...inviter, writerEnabled: true, writerId: 'withdrawal-test', autoRecover: false,
    allowedAccounts: [7], gate: f.runtime.gate, withdrawal: { provider: f.provider, store: f.runtime.store },
    now: () => new Date(f.runtime.now()), sleep: f.runtime.sleep }
  const service = createConnectionInviterService(options)
  try {
    const preview = await service.withdrawals!.preview(7)
    const release = f.runtime.gate.acquire('profile_filler', 'other', '7')
    await assert.rejects(service.withdrawals!.start(7, preview.token))
    release?.()
    await assert.rejects(service.withdrawals!.preview(8))
    assert.deepEqual(f.calls, [])
    const readonly = createConnectionInviterService({ ...options, writerEnabled: false })
    try { await assert.rejects(readonly.withdrawals!.start(7, preview.token)) } finally { readonly.stop() }
    const injected = createConnectionInviterService({ ...inviter, writerEnabled: false, autoRecover: false })
    try { assert.equal(injected.withdrawals, undefined) } finally { injected.stop() }
  } finally { service.stop() }
})
test('shared writer lock is retained until an in-flight withdrawal finishes after shutdown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'withdrawal-lock-test-'))
  const f = fixture(), inviter = inviterFixture({ stack: 'Frontend' })
  let began!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { began = resolve }), cancel = f.provider.cancel
  f.provider.cancel = async (a, id) => { began(); await new Promise<void>(resolve => { release = resolve }); await cancel(a, id) }
  const options = { ...inviter, writerEnabled: true, writerId: 'withdrawal-test', autoRecover: false,
    enforceWriterSingleton: true, writerLockPath: join(directory, 'writer.lock'), gate: f.runtime.gate,
    withdrawal: { provider: f.provider, store: f.runtime.store }, now: () => new Date(f.runtime.now()) }
  const service = createConnectionInviterService(options)
  try {
    const preview = await service.withdrawals!.preview(7)
    await service.withdrawals!.start(7, preview.token); await started
    service.stop()
    assert.throws(() => createConnectionInviterService(options), /writer.*active/)
    release(); await service.withdrawals!.close()
    await new Promise(resolve => setImmediate(resolve))
    const next = createConnectionInviterService(options); next.stop()
    assert.deepEqual(f.calls, ['1'])
  } finally { release?.(); service.stop(); await service.withdrawals!.close(); await rm(directory, { recursive: true, force: true }) }
})
