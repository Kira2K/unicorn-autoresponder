import test from 'node:test'
import assert from 'node:assert/strict'
import { scanBudgetControl } from '../infrastructure/scan-budget.ts'
import { CollectionPersistenceError } from '../vacancy_collection/persistence-error.ts'

test('scan budget uses the existing live preflight and stops collection rather than classifying a quota failure as a bad website',async()=>{
  const events:string[]=[],abort=new AbortController();let allowed=true
  const control=scanBudgetControl({signal:abort.signal,preflight:async({live}:any)=>{assert.equal(live,true);events.push('preflight')},start:()=>{events.push('watchdog')},admission:()=>({allowed,status:allowed?'ready':'hard_stopped',reason:allowed?'within_budget':'quota_hard_stop'}),stop:async()=>{events.push('stop')}} as any,async()=>{events.push('close')})
  await control.start();control.assertAdmission();allowed=false
  assert.throws(()=>control.assertAdmission(),error=>error instanceof CollectionPersistenceError&&error.message.includes('quota_hard_stop'))
  allowed=true;abort.abort();assert.throws(()=>control.assertAdmission(),CollectionPersistenceError)
  await control.close();assert.deepEqual(events,['preflight','watchdog','stop','close'])
})
test('failed live preflight never starts the watcher or work; cleanup always closes its client',async()=>{
  let started=false,closed=false
  const control=scanBudgetControl({preflight:async()=>{throw Error('quota_hard_stop_latched')},start:()=>{started=true},stop:async()=>{throw Error('report_failure')}} as any,async()=>{closed=true})
  await assert.rejects(control.start(),/quota_hard_stop_latched/);assert.equal(started,false)
  await assert.rejects(control.close(),/report_failure/);assert.equal(closed,true)
})

test('scan admission awaits quota recovery and wraps an exhausted recovery as a resumable infrastructure stop',async()=>{
  let release!:()=>void,admitted=false;const w:any={signal:new AbortController().signal,waitForAdmission:()=>new Promise<void>(r=>release=r),admission:()=>({reason:'rate_limit_read_failed'})}
  const control=scanBudgetControl(w,async()=>{}),pending=control.admit().then(()=>{admitted=true})
  await Promise.resolve();assert.equal(admitted,false);release();await pending;assert.equal(admitted,true)
  w.waitForAdmission=async()=>{throw Error('private diagnostic')};await assert.rejects(control.admit(),e=>e instanceof CollectionPersistenceError&&e.message==='collection_budget_stop:rate_limit_read_failed')
})
