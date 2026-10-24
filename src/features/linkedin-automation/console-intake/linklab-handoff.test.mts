import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncLinkLabAccount } from '../linklab/intake.mts';
import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
test('shared LinkLab handoff retains existing bindings and does not resend their handoff', async () => {
  const calls: string[] = [];
  await syncLinkLabAccount({ release() {}, async query(sql) { calls.push(sql); return { rows: [{ client_id: 7 }] }; } }, 7);
  assert.equal(calls.length, 1);
});
test('shared LinkLab handoff rejects ambiguous selection and only enrolls an eligible selected account', async () => {
  let selected: Record<string, unknown> = { platform_account_id: 10, data_issue: 'linkedin_account_ambiguous' };
  const mutations: unknown[][] = [];
  const sql: SqlSession = { release() {}, async query(text, values = []) {
    if (text.includes('chosen WHERE')) return { rows: [selected] };
    if (/^(INSERT|UPDATE)/.test(text)) mutations.push(values);
    return { rows: [] };
  } };
  await syncLinkLabAccount(sql, 7); assert.equal(mutations.length, 0);
  selected = { platform_account_id: 10 };
  await syncLinkLabAccount(sql, 7); assert.deepEqual(mutations, [[7,10],[7]]);
});
