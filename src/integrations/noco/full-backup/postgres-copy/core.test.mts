import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, canonical } from './json.mts';
import { readPages } from './pages.mts';
test('numeric literals and null/empty values survive canonical JSON', () => {
  assert.equal(canonical(parse('{"z":9007199254740993,"a":0.1234567890123456789,"n":null,"e":""}')),
    '{"a":0.1234567890123456789,"e":"","n":null,"z":9007199254740993}');
  assert.equal(canonical(parse('1.0000000000000000001')), '1.0000000000000000001');
});
test('pagination follows actual returned pages and checks IDs', async () => {
  const calls: Record<string, string>[] = [];
  const reader = { async get<T>(_path: string, query = {}): Promise<T> {
    calls.push(query); return { list: calls.length === 1 ? [{ Id: 1 }, { Id: 2 }] : [{ Id: 3 }],
      pageInfo: { isLastPage: calls.length === 2, totalRows: 3 } } as T;
  } };
  const rows = []; for await (const page of readPages(reader, '/rows', 'Id')) rows.push(...page);
  assert.equal(rows.length, 3); assert.equal(calls[1].offset, '2');
});
test('duplicate, unordered and unfinished empty pages fail closed', async () => {
  for (const list of [[{ Id: 1 }, { Id: 1 }], [{ Id: 2 }, { Id: 1 }], []]) {
    const reader = { async get<T>(): Promise<T> { return { list, pageInfo: { isLastPage: false } } as T; } };
    await assert.rejects(async () => { for await (const _ of readPages(reader, '/rows', 'Id')) { /* consume */ } });
  }
});
