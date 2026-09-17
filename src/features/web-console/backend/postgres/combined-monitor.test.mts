import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combinedFixture } from './combined-fixture.mts';
import { featureTestProviders } from './feature-test-providers.mts';
import { createSqlFeatureServices } from './feature-services.mts';
import { createSqlCommentStore } from '../../../linkedin-automation/storage-postgres/comment-store.mts';

test('Monitor restores SQL publishing state as uncertain, without another reply', async () => {
  const f=combinedFixture(),p=featureTestProviders(); let sends=0;
  p.providers.comments.adapter.reply=async()=>{sends++;throw Error('must not resend');};
  let services=await createSqlFeatureServices(f.db,f.grant,p.providers);
  const store=createSqlCommentStore(f.db,{accountIds:new Set([21]),create:f.grant.create});
  try {
    const start=await services.commentMonitor.enable(21);
    for(let i=0;i<100;i++){
      if((await store.get(String(start.jobId)))?.status==='waiting')break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    const job=await store.get(String(start.jobId));assert(job);assert.equal(job.status,'waiting');
    await services.close();
    const now=new Date().toISOString();
    await store.update({...job,status:'replying',stage:'publishing',
      expiresAt:new Date(Date.now()+60000).toISOString(),state:{...job.state,items:[{
        incomingId:'sql-comment',postId:'fake-post',threadId:'thread',parentId:'sql-comment',
        incomingText:'Question',threadText:'Thread',replyText:'A valid reply.',status:'publishing',
        createdAt:now,updatedAt:now
      }]}});
    services=await createSqlFeatureServices(f.db,f.grant,p.providers);
    for(let i=0;i<100;i++){
      if((await store.get(job.jobId))?.status==='paused')break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    const recovered=await store.get(job.jobId);
    assert.equal(recovered?.status,'paused');assert.equal(recovered?.state.items[0].status,'uncertain');
    assert.equal(sends,0);
    await services.commentMonitor.disable(21);
    assert.equal((await store.get(job.jobId))?.status,'disabled');
  } finally {await services.close();}
});
