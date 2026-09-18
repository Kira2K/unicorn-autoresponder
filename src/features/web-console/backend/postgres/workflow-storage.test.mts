import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { tableIds as t } from './tables.mts';
test('CV create/read/patch preserves the legacy contract and only provided fields', async () => {
  const a = workflowFixture(), b = workflowFixture();
  const left = await a.legacy.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
  const right = await b.sql.getResumeWorkflowByTelegramChatId('-7007', { ensure: true });
  assert.deepEqual(right, left); assert.ok(right);
  const patch = { cvDraftUrl: 'https://example.invalid/cv', lastRejectionComment: 'Unicode 😀', workflowTrace: 'trace', additionalVersions: '' };
  assert.deepEqual(await b.sql.patchResumeWorkflow(right.id, patch), await a.legacy.patchResumeWorkflow(left!.id, patch));
  assert.equal((await b.sql.getResumeWorkflowByTelegramChatId('-7007', { ensure: true }))?.id, right.id);
  assert.equal(b.rows.get(t.cv)?.size, 1);
  assert.equal((await b.sql.getResumeWorkflowById(right.id))?.status, "collection student's data");
  await b.sql.updateGoogleFolderByTelegramChatId('-7007', 'https://example.invalid/new-root');
  assert.equal(b.rows.get(t.clients)?.get('7')?.google_folder, 'https://example.invalid/new-root');
});
test('Telegram metadata keeps omitted activity, null and empty text distinct; ownership survives', async () => {
  const a = workflowFixture(), b = workflowFixture();
  const patch = { telegram_session_status: 'needs_code', telegram_tdlib_db_path: 'test-only/session',
    telegram_last_active: undefined, telegram_event_log: '[]', phone: '', password: 'must not persist' };
  assert.deepEqual(await b.sql.updateTelegramPlatformAccount(7, 22, patch), await a.legacy.updateTelegramPlatformAccount(7, 22, patch));
  assert.equal(b.rows.get(t.accounts)?.get('22')?.password, undefined);
  await b.sql.updateTelegramPlatformAccount(7, 22, { telegram_last_active: null });
  assert.equal(b.rows.get(t.accounts)?.get('22')?.telegram_last_active, null);
  await assert.rejects(b.sql.updateTelegramPlatformAccount(8, 22, { phone: 'no' }));
  assert.equal(b.rows.get(t.accounts)?.get('22')?.phone, '');
});
