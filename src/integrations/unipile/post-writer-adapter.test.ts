import test from 'node:test'
import assert from 'node:assert/strict'
import { createPostAdapter } from './post-writer-adapter.ts'
import type { Account } from '../../features/linkedin-automation/post-writer/types.ts'

for (const operation of ['publish','like'] as const) {
  test(`${operation}: a deadline reached while queued prevents the HTTP POST`,async()=>{
    let now=0,requests=0,checks=0
    const adapter=createPostAdapter(()=>{}, {async request(){requests++;throw Error('must not send')}},
      {async run(fn){now=20;return fn()}})
    const account={unipileAccountId:'synthetic'} as Account
    const guard=async()=>{checks++;if(now>=10)throw Object.assign(Error('deadline'),{code:'automation_task_timeout'})}
    await assert.rejects(operation==='publish' ? adapter.publish(account,'test',undefined,guard) :
      adapter.like(account,'synthetic-post',guard),{code:'automation_task_timeout'})
    assert.equal(checks,1);assert.equal(requests,0)
  })
}
