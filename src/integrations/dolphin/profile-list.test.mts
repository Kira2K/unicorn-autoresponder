import assert from 'node:assert/strict'
import test from 'node:test'
import { getDolphinProfilesPage, listAllDolphinProfiles } from './profile-list.mts'

const nextPage = (cursor: string) =>
  `https://dolphin-anty-api.com/browser_profiles/list-cursor?cursor=${encodeURIComponent(cursor)}`

function fixture(pages: unknown[]) {
  const calls: Array<{ path: string; query: unknown }> = []
  return {
    calls,
    request: async <T,>(path: string, options?: { query?: unknown }): Promise<T> => {
      calls.push({ path, query: options?.query })
      assert.ok(calls.length <= pages.length, 'Unexpected extra page request')
      return pages[calls.length - 1] as T
    }
  }
}

test('empty and single-page lists preserve profile fields and stop at the end', async () => {
  for (const data of [[], [{ id: 1, name: 'A', tags: ['work'], proxyId: 7, runs: [] }]]) {
    const f = fixture([{ data, total: data.length, next_page_url: null }])
    const result = await listAllDolphinProfiles({}, f.request)
    assert.deepEqual(result, data)
    if (data.length) assert.equal(result[0], data[0])
    assert.deepEqual(f.calls, [{ path: '/browser_profiles/list-cursor', query: { limit: 100 } }])
  }
})

test('follows opaque encoded cursors with unchanged filters, sorting and limit', async () => {
  const cursor = 'cursor+/= one'
  const query = { limit: 2, 'tags[]': 'work', 'query[]': 'Alice', sortBy: 'name', order: 'ASC' }
  const f = fixture([
    { data: [{ id: 1 }], total: 1, next_page_url: nextPage(cursor) },
    { data: [{ id: 2 }, { id: 3 }], total: 50, next_page_url: nextPage('last') },
    { data: [{ id: 4 }], total: 4, next_page_url: null }
  ])
  assert.deepEqual(await listAllDolphinProfiles(query, f.request),
    [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])
  assert.deepEqual(f.calls, [query, { ...query, cursor }, { ...query, cursor: 'last' }].map(params => ({
    path: '/browser_profiles/list-cursor', query: params
  })))
  assert.deepEqual(query, { limit: 2, 'tags[]': 'work', 'query[]': 'Alice', sortBy: 'name', order: 'ASC' })
})

test('does not lose later rows when a page is empty but provides a next cursor', async () => {
  const f = fixture([
    { data: [], next_page_url: nextPage('next') },
    { data: [{ id: 9 }], next_page_url: null }
  ])
  assert.deepEqual(await listAllDolphinProfiles({}, f.request), [{ id: 9 }])
})

test('overlapping pages return each ID once, keeping the first object and order', async () => {
  const f = fixture([
    { data: [{ id: 1, name: 'first' }, { id: 2 }], total: 3, next_page_url: nextPage('next') },
    { data: [{ id: '1', name: 'overlap' }, { id: 3 }, { id: 3 }], total: 3, next_page_url: null }
  ])
  assert.deepEqual(await listAllDolphinProfiles({}, f.request),
    [{ id: 1, name: 'first' }, { id: 2 }, { id: 3 }])
})

test('rejects a premature end at 200 of 201 profiles, including a missing final total', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => ({ id: index + 1 }))
  for (const ending of [undefined, null]) {
    for (const finalTotal of [201, undefined]) {
      const f = fixture([
        { data: rows.slice(0, 100), total: 201, next_page_url: nextPage('next') },
        { data: rows.slice(100, 200), total: finalTotal, next_page_url: ending }
      ])
      await assert.rejects(listAllDolphinProfiles({}, f.request), /неполный.*200.*201/)
      assert.equal(f.calls.length, 2, 'An incomplete list fails without guessing another cursor or retrying')
    }
  }
})

test('rejects an empty result or overlapping rows that conceal missing profiles', async () => {
  for (const pages of [
    [{ data: [], total: 1, next_page_url: null }],
    [{ data: [{ id: 1 }], total: 3, next_page_url: nextPage('next') },
      { data: [{ id: 1 }, { id: 2 }], total: 3, next_page_url: null }]
  ]) {
    const f = fixture(pages)
    await assert.rejects(listAllDolphinProfiles({}, f.request), /неполный список профилей/)
  }
})

test('uses the latest reported total when the catalogue shrinks during traversal', async () => {
  const f = fixture([
    { data: [{ id: 1 }], total: 3, next_page_url: nextPage('next') },
    { data: [{ id: 2 }], total: 2, next_page_url: null }
  ])
  assert.deepEqual(await listAllDolphinProfiles({}, f.request), [{ id: 1 }, { id: 2 }])
})

test('detects repeated cursors and longer cursor cycles instead of returning a partial list', async () => {
  for (const cursors of [['a', 'a'], ['a', 'b', 'a']]) {
    const f = fixture(cursors.map((cursor, index) => ({ data: [{ id: index + 1 }], next_page_url: nextPage(cursor) })))
    await assert.rejects(listAllDolphinProfiles({}, f.request), /повтор.*cursor/i)
    assert.equal(f.calls.length, cursors.length)
  }
})

test('rejects malformed pages, IDs and next links rather than treating them as an empty list', async () => {
  for (const page of [null, {}, { data: null }, { data: {} },
    { data: [null] }, { data: [{}] }, { data: [{ id: '' }] },
    { data: [], next_page_url: 7 }, { data: [], next_page_url: '' },
    { data: [], next_page_url: 'https://dolphin-anty-api.com/browser_profiles/list-cursor?limit=100' }]) {
    const f = fixture([page])
    await assert.rejects(listAllDolphinProfiles({}, f.request), /Dolphin/)
  }
})

test('never follows a supplied external host or path; only extracts the cursor', async () => {
  const f = fixture([
    { data: [{ id: 1 }], next_page_url: 'https://other.invalid/anything?cursor=next&limit=1&tags[]=other' },
    { data: [{ id: 2 }], next_page_url: null }
  ])
  await listAllDolphinProfiles({ 'tags[]': 'work' }, f.request)
  assert.deepEqual(f.calls[1], {
    path: '/browser_profiles/list-cursor', query: { limit: 100, 'tags[]': 'work', cursor: 'next' }
  })
})

test('propagates a later request failure without returning collected profiles', async () => {
  const failure = new Error('API unavailable')
  let calls = 0
  await assert.rejects(listAllDolphinProfiles({}, async <T,>() => {
    if (++calls === 1) return { data: [{ id: 1 }], next_page_url: nextPage('next') } as T
    throw failure
  }), error => error === failure)
  assert.equal(calls, 2)
})

test('single-page diagnostics retain the response envelope and requested limit', async () => {
  const page = { data: [{ id: 1 }], total: 25, per_page: 1, runsAvailable: false, next_page_url: nextPage('next') }
  const f = fixture([page])
  assert.equal(await getDolphinProfilesPage({ limit: 1 }, f.request), page)
  assert.deepEqual(f.calls, [{ path: '/browser_profiles/list-cursor', query: { limit: 1 } }])
})

test('bounds requests even when a broken API returns endlessly new cursors', async () => {
  let calls = 0
  await assert.rejects(listAllDolphinProfiles({}, async <T,>() => ({
    data: [{ id: ++calls }], next_page_url: nextPage(String(calls))
  }) as T), /лимит.*страниц/i)
  assert.equal(calls, 10_000)
})
