const fs=require('node:fs'),path=require('node:path');
const {ROOT,REPO,FOLDER,read,save,sleep,report,Api,bi}=require('./live.cjs');
const {SUPPORT_FOLDER}=require('./local-extra-auth.cjs'),{sameTelegramText,canonicalText}=require('./telegram-text.cjs'),{hash,NOTICE}=require('./plan.cjs');
const {joinOne}=require('./support-join-one.cjs');
function alive(pid){try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
async function main(){
 if(process.platform!=='win32')throw Error('local_support_windows_only');
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'support-join.lock'));let c;
 try{
  const authPid=Number(process.argv.find(v=>v.startsWith('--auth-pid='))?.split('=')[1]||0);
  while(!fs.existsSync(path.join(SUPPORT_FOLDER,'identity.json'))||(authPid&&alive(authPid))){report('support_waiting_for_local_auth');await sleep(50000);}
  if(fs.realpathSync(SUPPORT_FOLDER).toLowerCase().startsWith(path.resolve(REPO).toLowerCase()+path.sep))throw Error('support_session_must_stay_outside_repository');
  const identity=read(path.join(SUPPORT_FOLDER,'identity.json'));if(identity.username?.toLowerCase()!=='veu_support')throw Error('support_identity_mismatch');
  const cfg=require(REPO+'/src/integrations/telegram/tools/responses-application/index.ts').getConfig(),{TelegramClient}=require('telegram'),{StringSession}=require('telegram/sessions'),{Logger,LogLevel}=require('telegram/extensions/Logger');
  c=new TelegramClient(new StringSession(fs.readFileSync(path.join(SUPPORT_FOLDER,'gram.session'),'utf8').trim()),cfg.apiId,cfg.apiHash,{connectionRetries:1,requestRetries:1,floodSleepThreshold:0,baseLogger:new Logger(LogLevel.NONE)});
  await c.connect();const originalInvoke=c.invoke.bind(c);c.invoke=require('./read-rpc-gate.cjs').paceReadCalls({invoke:originalInvoke,sleep,onWait:r=>report('support_read_wait',{method:r.method,seconds:r.seconds})});
  const me=await c.getMe();if(String(me.id)!==identity.id||me.username?.toLowerCase()!=='veu_support'||me.bot)throw Error('support_identity_mismatch');
  const folder=path.join(FOLDER,'support-self-join',identity.id);fs.mkdirSync(folder,{recursive:true});
  const collected=require('./restored-targets.cjs').collectTargets([FOLDER,path.join(REPO,'storage/group-restoration-additional')],read);
  const plans=collected.map(r=>r.plan),stateFiles=new Map(collected.map(r=>[r.plan.clientId,r.stateFile]));
  const stateFor=id=>read(stateFiles.get(id));
  const targets=plans.filter(p=>{const s=stateFor(p.clientId);return s?.chatId&&!s.skipped&&s.invitation&&(s.complete||s.steps?.invite?.done||s.steps?.early_invite?.done);}).sort((a,b)=>a.operations.length-b.operations.length||Number(a.clientId)-Number(b.clientId));
  const receiptFile=id=>path.join(folder,'client-'+id+'.json'),rateFile=path.join(folder,'rate.json');
  save(path.join(folder,'manifest.json'),{accountId:identity.id,username:'veu_support',createdAt:new Date().toISOString(),targets:targets.map(p=>({clientId:p.clientId,chatId:stateFor(p.clientId).chatId}))});
  function snapshot(status='running'){const groups=targets.map(p=>{const r=read(receiptFile(p.clientId));return{clientId:p.clientId,chatId:stateFor(p.clientId).chatId,status:r?.status||'waiting',verified:!!r?.done,membershipAccepted:!!r?.accepted,error:r?.error,retryAt:r?.retryAt};});save(path.join(folder,'report.json'),{at:new Date().toISOString(),accountId:identity.id,status,groups});return groups;}
  async function waitUntil(at){while(Date.now()<at)await sleep(Math.min(at-Date.now(),50000));}
  async function verifyHistory(plan,state,chat){
   const peer=await c.getInputEntity(chat),full=await c.invoke(new Api.channels.GetFullChannel({channel:new Api.InputChannel({channelId:peer.channelId,accessHash:peer.accessHash})}));
   if(full.fullChat.hiddenPrehistory)throw Error('support_history_hidden');
   const rows=[];for await(const m of c.iterMessages(peer,{}))if(m.className==='Message')rows.push(m);
   if(plan.clientId==='92'){
    const legacy=read(ROOT+'/runtime/restoration/client-92-plan.json'),expected=new Map();
    for(const op of legacy.operations){const key=hash(canonicalText(op.text));expected.set(key,(expected.get(key)||0)+1);}
    const actual=new Map();for(const m of rows.filter(m=>String(m.senderId)==='8897025258')){const key=hash(canonicalText(m.message));actual.set(key,(actual.get(key)||0)+1);}
    if([...expected].some(([key,count])=>(actual.get(key)||0)<count)||!rows.some(m=>sameTelegramText(NOTICE,m.message||'')))throw Error('support_history_not_fully_visible');return;
   }
   const byId=new Map(rows.map(m=>[m.id,m]));
   for(const op of plan.operations){const d=state.deliveries?.[op.key];if(!d?.done)continue;const m=byId.get(d.result.messageId);if(!m||!sameTelegramText(op.text,m.message||'')||String(m.senderId)!==(d.result.senderId||'8897025258'))throw Error('support_history_not_fully_visible');if(op.file&&Number(m.media?.document?.size)!==op.file.bytes)throw Error('support_history_attachment_mismatch');}
  }
  const first=process.argv.find(v=>v.startsWith('--resume-client='))?.split('=')[1];if(first)targets.sort((a,b)=>Number(b.clientId===first)-Number(a.clientId===first));
  snapshot();let pilotPassed=read(path.join(folder,'pilot.json'))?.done;
  for(const plan of targets){let state=stateFor(plan.clientId);state={...state,channel:state.channel||{id:String(-BigInt(state.chatId)-1000000000000n)},steps:{...state.steps,invite:{done:true}}};
   let r=read(receiptFile(plan.clientId))||{};
   if(r.error==='support_join_outcome_unresolved'||r.stopAccount){snapshot('blocked');return;}
   for(;;){if(r.retryAt)await waitUntil(r.retryAt);
    r=await joinOne(plan,state,r,{accountId:identity.id,now:Date.now,save:value=>save(receiptFile(plan.clientId),value),checkInvite:token=>c.invoke(new Api.messages.CheckChatInvite({hash:token})),joinInvite:token=>c.invoke(new Api.messages.ImportChatInvite({hash:token})),waitForSlot:()=>waitUntil(read(rateFile)?.nextAt||0),advanceSlot:async()=>save(rateFile,{nextAt:Date.now()+60000}),verifyHistory});
    snapshot();if(r.status==='waiting'&&r.retryAt)continue;break;
   }
   report('support_group_result',{clientId:plan.clientId,status:r.status,error:r.error});
   if(r.stopAccount){snapshot('blocked');return;}
   if(!pilotPassed){if(!r.done){snapshot('pilot_failed');return;}pilotPassed=true;save(path.join(folder,'pilot.json'),{done:true,clientId:plan.clientId,chatId:state.chatId,accountId:identity.id,at:new Date().toISOString()});report('support_pilot_passed',{clientId:plan.clientId});}
  }
  const result=snapshot();snapshot(result.every(g=>g.verified)?'complete':'needs_review');report('support_queue_finished',{groups:result.length,verified:result.filter(g=>g.verified).length});
 }finally{await c?.disconnect();release();}
}
if(require.main===module)main().catch(e=>{const value=String(e.errorMessage||e.code||e.message),error=/^[\w:-]{1,120}$/.test(value)?value:'support_queue_failed';const id=read(path.join(SUPPORT_FOLDER,'identity.json'))?.id;if(/^\d+$/.test(id||'')){const file=path.join(FOLDER,'support-self-join',id,'report.json');save(file,{...(read(file)||{}),status:'stopped',error,at:new Date().toISOString()});}report('support_queue_stopped',{error});process.exitCode=1;});
