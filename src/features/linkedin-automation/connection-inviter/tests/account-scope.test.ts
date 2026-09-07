import assert from 'node:assert/strict'
import { createConnectionInviterService } from '../service.ts'
import { fixture } from './fixtures.ts'
import { makeRun } from '../run-model.ts'
export async function testAccountScope() {
  const f = fixture({stack:'GO'})
  const now = new Date('2026-08-29T09:00:00Z')
  const old = makeRun({platformAccountId:7,clientId:3,clientName:'Mock',
    linkedinUrl:'https://www.linkedin.com/in/mock/',accountId:'acc_test',stack:'GO'},now,'Europe/Moscow',false)
  await f.store.createRun(old)
  const service = createConnectionInviterService({...f,allowedAccounts:[99],autoRecover:false,
    now:() => now,sleep:async () => undefined})
  await assert.rejects(service.start(7), {code:'connection_account_not_allowed'})
  await assert.rejects(service.saveStack(7,10), {code:'connection_account_not_allowed'})
  await assert.rejects(service.stopRun(old.runId), {code:'connection_account_not_allowed'})
  await service.recover()
  assert.equal(f.metrics.sends,0)
  assert.equal(f.metrics.reads,0,'Blocked account must not reach Unipile')
  assert.equal(f.store.requestStats().patches,0,'Recovery must not modify another account')
  assert.deepEqual(await f.store.getRun(old.runId), {...old,recordId:1})
  assert.ok(await service.get(old.runId),'Read-only visibility is preserved')
  service.stop()
}
