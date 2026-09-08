import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryPostStore } from '../memory-store.ts'
import { createPostNocoStore } from '../noco-store.ts'
import { nocoFixture } from './noco-fixture.ts'
import type { History } from '../types.ts'

for (const [name, create] of [
  ['memory', createMemoryPostStore],
  ['noco', () => createPostNocoStore(nocoFixture().http)]
] as const) {
  test(`${name}: shared storage contract, isolation and unique claim`, async () => {
    const store = create()
    const row: History = { id: '203-hash', account: 203, runId: 'first', hash: 'hash',
      text: 'post', signature: 'topic', status: 'sending' }
    assert.equal(await store.get('history', row.id), undefined)
    const first = await store.claim(row.id, row)
    assert.equal(first.created, true)
    row.text = 'caller mutation'
    assert.equal((await store.get('history', row.id))!.text, 'post')
    const duplicate = await store.claim(row.id, { ...row, runId: 'second' })
    assert.equal(duplicate.created, false)
    assert.equal(duplicate.value.runId, 'first')
    const saved = (await store.get('history', row.id))!
    await store.put('history', row.id, { ...saved, status: 'published' })
    await store.put('history', '204-hash', { ...saved, id: '204-hash', account: 204 })
    const list = await store.list('history', 203)
    assert.equal(list.length, 1)
    assert.equal(list[0].status, 'published')
    list[0].text = 'returned mutation'
    assert.equal((await store.get('history', row.id))!.text, 'post')
    assert.equal((await store.list('history')).length, 2)
  })
}
