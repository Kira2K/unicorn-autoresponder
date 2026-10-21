import assert from 'node:assert/strict';
import {test} from 'node:test';
import {clientErrorReporter} from './error-reporting.mts';
import type {Store,Delivery} from './worker.ts';
const rejected={kind:'telegram-response' as const,response:{ok:false as const,error_code:400,description:'Bad Request: chat not found'}};
test('report throttling persists across reporter restarts, allows a new target, and respects the exact 24h boundary',async()=>{
  const journal=new Map<string,number>();
  const results:Delivery[]=[];
  const store:Store={claim:async()=>true,finish:async(_key,result)=>{results.push(result)},
    claimReport:async(key,_id,_points,at)=>{
      if(journal.has(key)&&at.getTime()-journal.get(key)!<86400000)return false;
      journal.set(key,at.getTime());return true;
    }};
  let clock=new Date('2026-10-21T16:00Z'),sends=0;
  const report={sourceChatId:'-100123',context:{clientId:3,clientName:'Student',chatPurpose:'Общий чат ученика'},result:rejected};
  const send=async()=>({kind:'telegram-response' as const,response:{ok:true as const,result:{message_id:++sends,date:1,chat:{id:-900,type:'supergroup' as const,title:'Reports'},text:'report'}}});
  for(let i=0;i<30;i++)await clientErrorReporter(store,()=>clock)(report,send);
  assert.equal(sends,1);
  clock=new Date('2026-10-22T15:59:59.999Z');await clientErrorReporter(store,()=>clock)(report,send);assert.equal(sends,1);
  clock=new Date('2026-10-22T16:00Z');await clientErrorReporter(store,()=>clock)(report,send);assert.equal(sends,2);
  await clientErrorReporter(store,()=>clock)({...report,sourceChatId:'-100456'},send);assert.equal(sends,3);
  assert.equal(results.length,3);
});
test('failed or unknown diagnostic delivery is reserved too and cannot flood the reports chat',async()=>{
  for(const failure of ['rejected','unknown']){
    const claimed=new Set<string>();let attempts=0;
    const store:Store={claim:async()=>true,finish:async()=>{},claimReport:async key=>{if(claimed.has(key))return false;claimed.add(key);return true}};
    const report=clientErrorReporter(store);
    const input={sourceChatId:'-100123',context:{clientId:3},result:rejected};
    const send=async()=>{attempts++;if(failure==='unknown')throw Error('lost response');return rejected};
    await report(input,send);await clientErrorReporter(store)(input,send);
    assert.equal(attempts,1);
  }
});
