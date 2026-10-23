// Read-only comparison of both sides of the basic-group -> supergroup migration.
const path=require('node:path');
const {FOLDER,ROOT,read,save,openCreator,Api,bi,sleep}=require('./live.cjs');
const {openObserver}=require('./audit-additional-sources.cjs');
const {hash,NOTICE}=require('./plan.cjs'),{canonicalText,sameTelegramText}=require('./telegram-text.cjs');
async function main(){
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));
 const legacy=read(ROOT+'/runtime/restoration/client-92-plan.json'),state=read(ROOT+'/runtime/restoration/client-92.json'),target=read(path.join(FOLDER,'galina-preserved.json'));
 const result={at:new Date().toISOString(),readOnly:true,clientId:'92',expected:legacy.operations.length,actors:[]};
 const expected=new Map();for(const op of legacy.operations){const k=hash(canonicalText(op.text));expected.set(k,(expected.get(k)||0)+1);}
 const safe=e=>({error:e.errorMessage||e.code||'audit_read_failed',method:e.rpcMethod,seconds:e.seconds});
 try{for(const key of ['support','unicorn']){
  const c=key==='support'?openObserver('support'):openCreator(key),record={account:key};
  try{await c.connect();c.invoke=require('./read-rpc-gate.cjs').paceReadCalls({invoke:c.invoke.bind(c),sleep,onWait:r=>console.log(JSON.stringify({event:'galina_read_wait',account:key,method:r.method,seconds:r.seconds}))});const me=await c.getMe();if(String(me.id)!==(key==='support'?'8222949251':'8805256389'))throw Error('galina_actor_mismatch');
   const d=(await c.getDialogs({limit:300})).find(d=>String(d.id)===target.chatId);if(!d)throw Error('galina_dialog_missing');
   const peer=d.inputEntity,full=await c.invoke(new Api.channels.GetFullChannel({channel:peer}));record.historyVisible=!full.fullChat.hiddenPrehistory;record.migratedFromChatId=String(full.fullChat.migratedFromChatId||'');record.migratedFromMaxId=full.fullChat.migratedFromMaxId;
   const all=[];
   for(const [part,p]of [['supergroup',peer],['basic',new Api.InputPeerChat({chatId:bi(state.migrationAuthorization.oldChatId)})]]){
    try{const rows=[];for await(const m of c.iterMessages(p,{}))if(m.className==='Message')rows.push(m);all.push(...rows);record[part]={messages:rows.length,botMessages:rows.filter(m=>String(m.senderId)==='8897025258').length,notice:rows.some(m=>sameTelegramText(NOTICE,m.message||''))};}catch(e){record[part]=safe(e);}
   }
   const actual=new Map();for(const m of all.filter(m=>String(m.senderId)==='8897025258')){const k=hash(canonicalText(m.message||''));actual.set(k,(actual.get(k)||0)+1);}
   record.missing=[...expected].reduce((n,[k,v])=>n+Math.max(0,v-(actual.get(k)||0)),0);record.notice=all.some(m=>sameTelegramText(NOTICE,m.message||''));record.fullyVisible=record.historyVisible&&record.missing===0&&record.notice;
  }catch(e){Object.assign(record,safe(e));}finally{await c.disconnect();}
  result.actors.push(record);save(path.join(FOLDER,'galina-support-audit.json'),result);console.log(JSON.stringify(record));
 }}finally{release();}
}
if(require.main===module)main().catch(e=>{console.error(e.code||'galina_audit_failed');process.exitCode=1;});
