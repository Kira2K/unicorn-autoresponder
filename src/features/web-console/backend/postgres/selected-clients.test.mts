import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workflowFixture } from './workflow-fixture.mts';
import { tableIds } from './tables.mts';
test('full client volume does not hydrate unrelated mentors; old normalized chat selection survives', async () => {
  const f = workflowFixture();
  for (let id=8; id<508; id++) f.set(tableIds.clients,id,{client_name:'Other',telegram_general_chat_id:String(-id)});
  let relations = 0; const read = f.db.listRelated;
  f.db.listRelated = async (...args) => { relations++; assert.deepEqual(args[2],['7']);return read(...args); };
  assert.deepEqual(await f.sql.findClientByTelegramChatId('-7007'),await f.legacy.findClientByTelegramChatId('-7007'));
  assert.equal(relations,1);
  await f.sql.getClientById(7); assert.equal(relations,2);
  f.rows.get(tableIds.clients)!.get('7')!.telegram_general_chat_id='-7.007e3';
  f.rows.get(tableIds.clients)!.get('8')!.telegram_general_chat_id='-7007';
  assert.equal((await f.sql.findClientByTelegramChatId('-7007.0'))?.id,7);
  assert.equal(relations,3);
});

test('secured group is used by client, CV and incoming folder commands', async () => {
  const f = workflowFixture();
  f.rows.get(tableIds.clients)!.get('7')!.secured_general_chat_id = ' -10070 ';
  for (const repo of [f.sql, f.legacy]) {
    assert.equal((await repo.getClientById(7)).commonChatId, '-10070');
    assert.equal((await repo.findClientByTelegramChatId('-10070.0'))?.id, 7);
    const wf = await repo.getResumeWorkflowByTelegramChatId('-10070', { ensure: true });
    assert.equal(wf?.commonChatId, '-10070');
    assert.equal((await repo.getResumeWorkflowById(wf!.id))?.commonChatId, '-10070');
    assert.equal(await repo.findClientByTelegramChatId('-7007'), null);
    assert.equal(await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true }), null);
    const writes = f.count();
    assert.equal(await repo.updateGoogleFolderByTelegramChatId('-7007', 'https://example.invalid/retired'), null);
    assert.equal(f.count(), writes, 'retired group cannot trigger a write');
    await repo.updateGoogleFolderByTelegramChatId('-10070', 'https://example.invalid/new');
    assert.equal((await repo.getClientById(7)).googleFolder, 'https://example.invalid/new');
    assert.equal((await repo.patchResumeWorkflow(wf!.id, { status: 'Draft in process' })).commonChatId, '-10070');
  }
});

test('empty secured values preserve original client and CV lookup', async () => {
  for (const secured of [undefined, null, '', '  ']) {
    const f = workflowFixture(); f.rows.get(tableIds.clients)!.get('7')!.secured_general_chat_id = secured;
    for (const repo of [f.sql, f.legacy]) {
      assert.equal((await repo.findClientByTelegramChatId('-7007'))?.commonChatId, '-7007');
      assert.equal((await repo.getResumeWorkflowByTelegramChatId('-7007', { ensure: true }))?.commonChatId, '-7007');
    }
  }
});
