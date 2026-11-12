const {test}=require('node:test'),assert=require('node:assert/strict');
const {runCampaign}=require('./campaign.cjs');
function fixture(){const calls=[];return {calls,dependencies:{check:async()=>{calls.push('checks');return {ok:true}},runMarket:async market=>{calls.push(market);return {exitCode:0,cleanupComplete:true,providerHealthy:true,deliveryComplete:true}},save:()=>{},report:async()=>{calls.push('report');return true}}};}
test('a failed new-service check prevents every profile and market start',async()=>{
 const f=fixture();f.dependencies.check=async()=>({ok:false});const result=await runCampaign({markets:['Ru','En']},f.dependencies);
 assert.equal(result.phase,'failed');assert.deepEqual(f.calls,['report']);
});
test('markets execute sequentially and a shared failure prevents EN',async()=>{
 const f=fixture();f.dependencies.runMarket=async market=>{f.calls.push(market);return {exitCode:0,cleanupComplete:false,providerHealthy:true}};
 assert.equal((await runCampaign({markets:['Ru','En']},f.dependencies)).phase,'failed');assert.deepEqual(f.calls,['checks','Ru','report']);
});
test('client errors stay isolated while provider outage / failed delivery is visible',async()=>{
 const f=fixture();const result=await runCampaign({markets:['Ru','En']},f.dependencies);assert.equal(result.phase,'complete');assert.deepEqual(f.calls,['checks','Ru','En','report']);
 for(const failure of [{providerHealthy:false},{exitCode:1},{deliveryComplete:false}]){
  const x=fixture();x.dependencies.runMarket=async()=>({exitCode:0,cleanupComplete:true,providerHealthy:true,deliveryComplete:true,...failure});
  assert.equal((await runCampaign({markets:['Ru','En']},x.dependencies)).phase,'failed');
 }
});
test('uncertain summary delivery is never retried and cannot become complete',async()=>{
 const f=fixture();let sends=0;f.dependencies.report=async()=>{sends++;return false;};
 assert.equal((await runCampaign({markets:['Ru']},f.dependencies)).phase,'failed');assert.equal(sends,1);
});

test('normal per-client failures do not block EN and remain visible in final phase',async()=>{
 const f=fixture();f.dependencies.runMarket=async market=>{f.calls.push(market);return {exitCode:0,cleanupComplete:true,providerHealthy:true,deliveryComplete:true,clientErrors:1}};
 assert.equal((await runCampaign({markets:['Ru','En']},f.dependencies)).phase,'completed_with_client_errors');assert.ok(f.calls.includes('En'));
});
