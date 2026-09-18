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
