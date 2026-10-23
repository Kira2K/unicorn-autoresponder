const path=require('node:path');
const c=require('./context.cjs');
const {OUT,FOLDER,file,read,save,lock,actor,rows,status,report,STACKS,ACCOUNTS}=c;
const {accountGate}=require('./account-gate.cjs'),{restoreStack}=require('./restore-live.cjs');
function snapshot(phase){const groups=STACKS.map(stack=>{const s=read(file('group-'+stack.key)),p=read(file('plan-'+stack.key));return{stackKey:stack.key,sourceChatId:stack.sourceChatId,chatId:s?.chatId,status:s?.completedAt?'complete':s?.lastError?'blocked':s?.chatId?'restoring':read(file('archive-'+stack.key))?.error?'archive_blocked':'waiting',done:Object.values(s?.deliveries||{}).filter(d=>d.done).length,total:p?.operations.length,files:p?.operations.filter(o=>o.file).length,pins:p?.pins,error:s?.lastError,historyVerified:!!s?.steps?.final_verify?.done,observerVerified:!!s?.steps?.unicorn_join?.done};});save(file('report'),{at:new Date().toISOString(),phase,groups});save(file('registry'),{at:new Date().toISOString(),groups:groups.filter(g=>g.status==='complete').map(g=>({...g,invitation:read(file('group-'+g.stackKey)).invitation}))});status(phase,{groups:groups.map(({stackKey,status,done,total})=>({stackKey,status,done,total}))});return groups;}
async function main(){const releases=[],clients=[];let timer,phase='restoring';
 try{
  for(const f of [path.join(FOLDER,'batch.lock'),file('run.lock')])releases.push(lock(f));
  const plans=read(file('plans'));if(!plans?.length)throw Error('stack_archives_required');
  const {audience}=require('./policy.cjs');save(file('audience'),{at:new Date().toISOString(),students:audience(await rows())});
  const owner=await actor('owner');clients.push(owner);let observer;
  const makeGate=key=>accountGate({load:()=>read(file('account-'+key)),save:r=>save(file('account-'+key),r),sleep:c.sleep,onWait:d=>report('stack_account_wait',{account:key,error:d.error,retryAt:d.retryAt})});
  const ownerGate=makeGate('owner'),ownerCreateGate=makeGate('owner-create'),observerGate=makeGate('observer');
  const rpc=(client,request)=>(client===owner?(request.className==='channels.CreateChannel'?ownerCreateGate:ownerGate):observerGate)(()=>client.invoke(request));
  let observerTail=Promise.resolve();
  const observe=(plan,state)=>{const task=observerTail.catch(()=>{}).then(async()=>{if(!observer){observer=await actor('observer');clients.push(observer);}return require('./observer-live.cjs').verifyObserver(plan,state,observer,rpc,observerGate);});observerTail=task;return task;};
  timer=setInterval(()=>snapshot(phase),30000);timer.unref();
  const sorted=[...plans].sort((a,b)=>a.sourceMessages-b.sourceMessages||a.stackKey.localeCompare(b.stackKey));
  async function run(plan){try{const result=await restoreStack(plan,owner,rpc,ownerGate,observe);snapshot(phase);return result;}catch(e){report('stack_restore_blocked',{stack:plan.stackKey,error:e.errorMessage||e.code||e.message});snapshot(phase);return null;}}
  snapshot(phase);const pilot=await run(sorted[0]);if(!pilot?.completedAt){phase='pilot_blocked';snapshot(phase);return;}
  save(file('pilot'),{done:true,stackKey:sorted[0].stackKey,chatId:pilot.chatId,verifiedAt:new Date().toISOString()});report('stack_pilot_passed',{stack:sorted[0].stackKey});
  await Promise.all(sorted.slice(1).map(run));
  phase='inviting';snapshot(phase);
  if(!observer){observer=await actor('observer');clients.push(observer);}
  await require('./invitations-live.cjs').sendInvitations({owner,observer,ownerGate,observerGate});
  phase='finished';snapshot(phase);
 }finally{if(timer)clearInterval(timer);for(const client of clients)await client.disconnect().catch(()=>{});for(const release of releases.reverse())release();}
}
module.exports={main,snapshot};
if(require.main===module)main().then(()=>process.exit(0),e=>{status('stopped',{error:e.errorMessage||e.code||e.message});process.exit(1);});
