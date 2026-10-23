const fs=require('node:fs'),path=require('node:path');
const {ROOT,REPO,FOLDER,read,save,openDb,report}=require('./live.cjs');
const OUT=path.join(REPO,'storage/group-restoration-additional'),DATA=ROOT+'/additional-27';
function configure(){const runtime=require(ROOT+'/tools/runtime.cjs');runtime.dirs.root=DATA;runtime.dirs.archive=DATA+'/archive';runtime.dirs.reports=DATA+'/reports';for(const p of [runtime.dirs.root,runtime.dirs.archive,runtime.dirs.reports])fs.mkdirSync(p,{recursive:true});return runtime;}
async function main(){
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(OUT,'archive.lock'));configure();
 try{
 save(path.join(OUT,'archive-status.json'),{at:new Date().toISOString(),status:'running'});
 const smoke=read(path.join(OUT,'write-smoke.json'));const selected=smoke.groups.filter(g=>g.sends.bot?.error?.includes('CHAT_RESTRICTED')&&g.sends.support?.error==='CHAT_RESTRICTED');if(selected.length!==27)throw Error('additional_broken_scope_mismatch');
 let inventory=read(DATA+'/reports/inventory.json');
 if(!inventory){const db=await openDb();let clients;try{clients=(await db.query('SELECT c.id,c.client_name,c.client_status,btrim(c.telegram_general_chat_id) chat_id,c.secured_general_chat_id,st.name stack FROM noco.clients c LEFT JOIN noco.stacks st ON st.id=c."01_stacks_id" WHERE c.id=ANY($1::bigint[])',[selected.map(g=>g.clientId)])).rows;}finally{await db.end();}
  const {client,invoke}=await require(ROOT+'/tools/source.cjs').openSource();const targets=[],eligible=[];
  try{await require(ROOT+'/tools/source.cjs').loadChats(invoke);for(const c of clients){const verified=selected.find(g=>g.clientId===String(c.id));if(c.chat_id!==verified.chatId)throw Error('additional_source_changed');if(c.secured_general_chat_id)throw Error('additional_secured_already_present');
   const chat=await invoke({_: 'getChat',chat_id:Number(c.chat_id)}),full=await invoke({_: 'getSupergroupFullInfo',supergroup_id:chat.type.supergroup_id});
   const legacy=full.upgraded_from_basic_group_id?String(-Math.abs(full.upgraded_from_basic_group_id)):null;
   const item={...c,id:String(c.id),chat_id:c.chat_id};delete item.secured_general_chat_id;eligible.push(item);if(legacy)eligible.push({...item,id:item.id+'-legacy',chat_id:legacy});targets.push({clientId:item.id,sourceChatId:item.chat_id,legacyChatId:legacy});report('additional_archive_source',{clientId:item.id,legacy:!!legacy});
  }}finally{await client.close();}
  inventory={createdAt:new Date().toISOString(),eligible,targets};save(DATA+'/reports/inventory.json',inventory);save(path.join(OUT,'restoration-manifest.json'),{createdAt:inventory.createdAt,targets,creatorPriority:['unicorn','kira','local'],senderPriority:['bot','unicorn','kira','local'],concurrency:8});
 }
 let estimate=read(DATA+'/reports/estimate.json');if(!estimate?.summary?.allowed)estimate=await require(ROOT+'/tools/estimate.cjs').estimate();if(!estimate.summary.allowed)throw Error('additional_archive_estimate_blocked');
 let exported=read(DATA+'/reports/export.json');if(exported?.completeGroups!==inventory.eligible.length)exported=await require(ROOT+'/tools/export.cjs').exportArchive();if(exported.completeGroups!==inventory.eligible.length)throw Error('additional_archive_incomplete');
 const avatars=await require(ROOT+'/tools/archive-avatars.cjs').archiveAvatars();if(avatars.failed)throw Error('additional_avatar_incomplete');
 const {DatabaseSync}=require('node:sqlite'),d=new DatabaseSync(DATA+'/archive/archive.sqlite',{readOnly:true});
 try{const users=new Map(d.prepare('SELECT id,payload FROM users').all().map(r=>[String(r.id),JSON.parse(r.payload)])),{ordinary}=require(ROOT+'/tools/history.cjs'),{parts}=require(ROOT+'/tools/pilot-contract.cjs'),{mergeMigratedSource}=require('./merge-migrated-source.cjs');
  const load=id=>d.prepare('SELECT payload,pinned FROM messages WHERE chat_id=?').all(id).map(r=>({...JSON.parse(r.payload),pinned:!!r.pinned})).filter(ordinary);
  const plans=inventory.targets.map(t=>{const row=d.prepare('SELECT payload,complete FROM groups WHERE chat_id=?').get(t.sourceChatId);if(!row?.complete)throw Error('additional_source_incomplete');const group=JSON.parse(row.payload),messages=t.legacyChatId?mergeMigratedSource(load(t.sourceChatId),load(t.legacyChatId),t.legacyChatId):load(t.sourceChatId);
   const plan=require('./plan.cjs').buildPlan({group,messages,users,cutoff:estimate.cutoff,renderParts:parts,media:f=>{const m=d.prepare('SELECT * FROM media WHERE key=?').get(f.uniqueId||'file_'+f.fileId);if(m?.state!=='complete')throw Error('additional_attachment_incomplete');const absolute=path.resolve(DATA+'/archive',m.path);if(!absolute.startsWith(path.resolve(DATA+'/archive')+path.sep)||fs.statSync(absolute).size!==m.bytes||require('./plan.cjs').hash(fs.readFileSync(absolute))!==m.sha256)throw Error('additional_attachment_corrupt');return{path:absolute,name:path.basename(f.name||absolute),bytes:m.bytes,sha256:m.sha256};}});
   return {...plan,legacyChatId:t.legacyChatId};
  });
  const previous=read(path.join(OUT,'plans.json'));if(previous&&JSON.stringify(previous.map(p=>p.planHash))!==JSON.stringify(plans.map(p=>p.planHash)))throw Error('additional_plan_changed');save(path.join(OUT,'plans.json'),plans);report('additional_plans_ready',{groups:plans.length,messages:plans.reduce((n,p)=>n+p.operations.length,0)});
 }finally{d.close();}
 save(path.join(OUT,'archive-status.json'),{at:new Date().toISOString(),status:'complete'});
 }finally{release();}
}
module.exports={main,configure,DATA,OUT};
if(require.main===module)main().catch(e=>{const code=String(e.errorMessage||e.code||e.message);save(path.join(OUT,'archive-status.json'),{at:new Date().toISOString(),status:'blocked',error:/^[\w:-]{1,120}$/.test(code)?code:'additional_archive_failed'});report('additional_archive_stopped',{error:/^[\w:-]{1,120}$/.test(code)?code:'additional_archive_failed'});process.exitCode=1;});
