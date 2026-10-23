const fs=require('node:fs'),path=require('node:path');
const {ROOT,FOLDER,DATA,OUT,read,save,file,status,report,lock,manifest,STACKS}=require('./context.cjs');
const {stackPlan}=require('./plan.cjs');
const {hash}=require('../telegram-group-restoration/plan.cjs');
async function prepareArchive(){
 const release=lock(path.join(FOLDER,'stack-source-archive.lock'));let source,store;
 try{
  const m=manifest(),runtime=require(ROOT+'/tools/runtime.cjs');
  Object.assign(runtime.dirs,{root:DATA,archive:path.join(DATA,'archive'),reports:path.join(DATA,'reports')});
  for(const dir of [DATA,runtime.dirs.archive,runtime.dirs.reports])fs.mkdirSync(dir,{recursive:true});
  store=require(ROOT+'/tools/store.cjs').openStore();
  const {resolveFiles}=require(ROOT+'/tools/estimate.cjs'),{historyPages,pins,ordinary}=require(ROOT+'/tools/history.cjs');
  const {parts}=require(ROOT+'/tools/pilot-contract.cjs'),{download}=require(ROOT+'/tools/media.cjs'),{selectAvatar}=require(ROOT+'/tools/avatar-contract.cjs');
  const seenUsers=new Set();
  let readSource;const invoke=request=>readSource(request);
  async function consume(message,pinned=false){
   if(message.date>m.upperDate||(!pinned&&message.date<m.cutoff))return;
   const clean=await resolveFiles(invoke,message);store.message(clean,pinned);
   const id=message.sender_id?.user_id;if(id&&!seenUsers.has(String(id))){seenUsers.add(String(id));try{store.user(require(ROOT+'/tools/rules.cjs').scrub(await invoke({_: 'getUser',user_id:Number(id)})));}catch{}}
   for(const f of clean.files||[])if(f.policy.keep)store.media({...f,chatId:String(message.chat_id),messageId:String(message.id)});
  }
  source=await require(ROOT+'/tools/source.cjs').openSource();
  readSource=require('./source-reader.cjs').sourceReader({invoke:r=>source.client.invoke(r),load:()=>read(file('account-source')),save:r=>save(file('account-source'),r),sleep:require('./context.cjs').sleep,onWait:d=>report('stack_source_wait',{error:d.error,retryAt:d.retryAt})});
  for(const stack of STACKS){
   const archiveFile=file('archive-'+stack.key);let a=read(archiveFile)||{stackKey:stack.key,sourceChatId:stack.sourceChatId};
   if(a.complete){report('stack_archive_already_complete',{stack:stack.key});continue;}
   try{
    status('archiving',{stack:stack.key});
    if(!a.sources){
     const chat=await invoke({_: 'getChat',chat_id:Number(stack.sourceChatId)});
     if(chat.type?._!=='chatTypeSupergroup')throw Error('stack_source_not_supergroup');
     const full=await invoke({_: 'getSupergroupFullInfo',supergroup_id:chat.type.supergroup_id});
     const entity=await invoke({_: 'getSupergroup',supergroup_id:chat.type.supergroup_id});
     let current;try{current=await invoke({_: 'getChatPinnedMessage',chat_id:Number(stack.sourceChatId)});}catch(e){if(Number(e.code)!==404)throw e;}
     a={...a,chat:require(ROOT+'/tools/rules.cjs').scrub(chat),full:require(ROOT+'/tools/rules.cjs').scrub(full),entity:require(ROOT+'/tools/rules.cjs').scrub(entity),currentPinnedId:current?String(current.id):null,sources:[stack.sourceChatId]};
     if(full.upgraded_from_basic_group_id)a.sources.push(String(-Math.abs(full.upgraded_from_basic_group_id)));
     save(archiveFile,a);
     if(current)await consume(current,true);
    }
    for(const sourceId of a.sources){
     if(!store.state(sourceId))store.group({id:stack.key,chat_id:sourceId,chat:sourceId===stack.sourceChatId?a.chat:undefined});
     if(store.state(sourceId).complete)continue;
     const cursor=store.state(sourceId).cursor||0;
     for await(const page of historyPages(invoke,sourceId,{cutoff:m.cutoff,from:cursor,local:false})){
      for(const message of page.messages)await consume(message);
      store.checkpoint(sourceId,page.next,false);
      report('stack_archive_page',{stack:stack.key,source:sourceId,messages:store.db.prepare('SELECT count(*) n FROM messages WHERE chat_id=?').get(sourceId).n});
     }
     for(const message of await pins(invoke,sourceId))if(message.date>=m.cutoff||sourceId===stack.sourceChatId&&String(message.id)===a.currentPinnedId)await consume(message,true);
     store.checkpoint(sourceId,store.state(sourceId).cursor,true);
    }
    const sourceMessages=a.sources.flatMap(id=>store.db.prepare('SELECT payload FROM messages WHERE chat_id=?').all(id).map(r=>JSON.parse(r.payload)));
    if(sourceMessages.some(message=>message.files?.some(f=>f.policy.reason==='unknown_size')))throw Error('stack_attachment_size_unknown');
    const files=new Map(sourceMessages.flatMap(message=>(message.files||[]).filter(f=>f.policy.keep).map(f=>[f.uniqueId||'file_'+f.fileId,f])));
    if([...files.values()].reduce((sum,f)=>sum+f.size,0)>4500000000)throw Error('stack_archive_size_budget_exceeded');
    for(const [key,f] of files){
     const old=store.db.prepare('SELECT * FROM media WHERE key=?').get(key);
     if(old?.state==='complete'){const b=fs.readFileSync(path.join(runtime.dirs.archive,old.path));if(b.length!==old.bytes||hash(b)!==old.sha256)throw Error('stack_cached_attachment_corrupt');continue;}
     const got=await download(invoke,f,{budget:5000000000});
     store.db.prepare("UPDATE media SET state='complete',path=?,sha256=?,bytes=? WHERE key=?").run(path.relative(runtime.dirs.archive,got.path),got.sha256,got.bytes,key);
     report('stack_archive_attachment',{stack:stack.key,bytes:got.bytes});
    }
    if(a.avatar===undefined){const avatar=selectAvatar({chat_id:stack.sourceChatId,chat:a.chat,full:a.full});
     if(!avatar)a.avatar=null;
     else{if(!avatar.file.policy.keep)throw Error('stack_avatar_not_transferable');const got=await download(invoke,avatar.file,{budget:5000000000});a.avatar={path:got.path,bytes:got.bytes,sha256:got.sha256};}
     save(archiveFile,a);
    }
    const load=id=>store.db.prepare('SELECT payload,pinned FROM messages WHERE chat_id=?').all(id).map(r=>({...JSON.parse(r.payload),pinned:!!r.pinned})).filter(ordinary);
    let messages=load(stack.sourceChatId);for(const legacyId of a.sources.slice(1))messages=require('../telegram-group-restoration/merge-migrated-source.cjs').mergeMigratedSource(messages,load(legacyId),legacyId);
    const users=new Map(store.db.prepare('SELECT id,payload FROM users').all().map(r=>[String(r.id),JSON.parse(r.payload)]));
    const plan=stackPlan({stack,group:{chat_id:stack.sourceChatId,chat:a.chat},messages,users,cutoff:m.cutoff,endDate:m.upperDate,currentPinnedId:a.currentPinnedId,renderParts:parts,media:f=>{const r=store.db.prepare('SELECT * FROM media WHERE key=?').get(f.uniqueId||'file_'+f.fileId);if(r?.state!=='complete')throw Error('stack_required_attachment_incomplete');return{path:path.join(runtime.dirs.archive,r.path),bytes:r.bytes,sha256:r.sha256,name:path.basename(f.name||r.path)};}});
    const planFile=file('plan-'+stack.key),oldPlan=read(planFile);if(oldPlan&&oldPlan.planHash!==plan.planHash)throw Error('stack_frozen_plan_changed');save(planFile,{...plan,avatar:a.avatar});
    a.complete=true;a.completedAt=new Date().toISOString();a.sourceMessages=plan.sourceMessages;a.operations=plan.operations.length;a.files=plan.operations.filter(o=>o.file).length;a.pins=plan.pins;delete a.error;save(archiveFile,a);
    report('stack_archive_complete',{stack:stack.key,messages:a.sourceMessages,operations:a.operations,files:a.files,pins:a.pins});
   }catch(e){const error=String(e.errorMessage||e.code||e.message);a.error=/^[\w:-]{1,120}$/.test(error)?error:'stack_archive_failed';save(archiveFile,a);report('stack_archive_blocked',{stack:stack.key,error:a.error});}
  }
  const plans=STACKS.map(s=>read(file('archive-'+s.key))?.complete?read(file('plan-'+s.key)):null).filter(Boolean);save(file('plans'),plans);status('archive_finished',{ready:plans.length,total:STACKS.length});return plans;
 }finally{if(source)await source.client.close();if(store)store.close();release();}
}
module.exports={prepareArchive};
if(require.main===module)prepareArchive().then(()=>process.exit(0),e=>{report('archive_stopped',{error:e.code||e.errorMessage||e.message});process.exit(1);});
