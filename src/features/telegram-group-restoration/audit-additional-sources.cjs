const fs=require('node:fs'),path=require('node:path');
const {ROOT,REPO,FOLDER,read,save,openDb,openCreator,Api,bi,sleep,report}=require('./live.cjs');
const {classifySource}=require('./source-health.cjs');
const OUTPUT=path.join(REPO,'storage/group-restoration-additional');
function openObserver(key){
 if(key!=='support')return openCreator(key);
 const {SUPPORT_FOLDER}=require('./local-extra-auth.cjs'),identity=read(path.join(SUPPORT_FOLDER,'identity.json'));
 if(identity?.id!=='8222949251'||identity.username?.toLowerCase()!=='veu_support')throw Error('source_support_identity_mismatch');
 const cfg=require(REPO+'/src/integrations/telegram/tools/responses-application/index.ts').getConfig(),{TelegramClient}=require('telegram'),{StringSession}=require('telegram/sessions'),{Logger,LogLevel}=require('telegram/extensions/Logger');
 const c=new TelegramClient(new StringSession(fs.readFileSync(path.join(SUPPORT_FOLDER,'gram.session'),'utf8').trim()),cfg.apiId,cfg.apiHash,{connectionRetries:1,requestRetries:1,floodSleepThreshold:0,baseLogger:new Logger(LogLevel.NONE)});c.restorationOwnerId=identity.id;return c;
}
async function main(){
 fs.mkdirSync(OUTPUT,{recursive:true});
 let manifest=read(path.join(OUTPUT,'manifest.json'));
 if(!manifest){const candidates=read(path.join(REPO,'storage/mentor-audit/missing-restored-groups.json')).results.filter(c=>c.client_status==='studying'&&c.client_name&&!/test|тест|octo|октон/i.test(c.client_name));if(candidates.length!==30)throw Error('unexpected_additional_cohort');manifest={createdAt:new Date().toISOString(),clientIds:candidates.map(c=>String(c.id)),scope:'audit_only_broken_sources',creatorPriority:['unicorn','kira','local'],senderPriority:['bot','unicorn','kira','local']};save(path.join(OUTPUT,'manifest.json'),manifest);}
 const sql=await openDb();let clients;
 try{clients=(await sql.query('SELECT id,client_name,client_status,btrim(telegram_general_chat_id) AS source_chat_id,btrim(secured_general_chat_id) AS secured_chat_id FROM noco.clients WHERE id=ANY($1::bigint[]) AND coalesce(__nc_deleted,false)=false',[manifest.clientIds])).rows;}finally{await sql.end();}
 if(clients.length!==manifest.clientIds.length)throw Error('additional_clients_changed');
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));
 const priorAudit=read(path.join(OUTPUT,'audit.json'));
 const previous=priorAudit?.healthPolicyVersion===2?priorAudit.groups:[];
 const rows=clients.map(c=>{const old=previous.find(r=>String(r.id)===String(c.id)&&r.source_chat_id===c.source_chat_id);return {...c,observations:old?.observations||[],status:c.secured_chat_id?'secured_present':c.client_status!=='studying'?'status_changed':old?.status||'needs_review'};});
 const snapshot=()=>save(path.join(OUTPUT,'audit.json'),{at:new Date().toISOString(),healthPolicyVersion:2,groups:rows});
 try{for(const key of process.argv.includes('--support-only')?['support']:['kira','unicorn','local','support']){
  const pending=rows.filter(r=>!['healthy','broken','secured_present','status_changed'].includes(r.status));if(!pending.length)break;
  let releaseSupport;if(key==='support')releaseSupport=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'support-join.lock'));
  const c=openObserver(key);let accountError;
  try{await c.connect();if(String((await c.getMe()).id)!==c.restorationOwnerId)throw Error('source_audit_identity_mismatch');const dialogs=await c.getDialogs({limit:500});
   for(const row of pending){const observation={account:key,at:new Date().toISOString()};try{
    const dialog=dialogs.find(d=>String(d.id)===row.source_chat_id);const peer=dialog?.inputEntity||await c.getInputEntity(bi(row.source_chat_id));const entity=dialog?.entity||await c.getEntity(peer);
    observation.restrictions=(entity.restrictionReason||[]).map(r=>({reason:r.reason,platform:r.platform}));observation.title=entity.title;observation.left=!!entity.left;
    if(!observation.restrictions.some(r=>r.reason==='terms'&&r.platform==='all')){
     const full=peer.className==='InputPeerChat'?await c.invoke(new Api.messages.GetFullChat({chatId:peer.chatId})):await c.invoke(new Api.channels.GetFullChannel({channel:peer}));observation.fullReadable=!!full.fullChat;
     await c.getMessages(peer,{limit:1});observation.historyReadable=true;
     const banned=entity.bannedRights||entity.defaultBannedRights;observation.canCommunicate=!entity.broadcast&&!entity.left&&!entity.deactivated&&!banned?.viewMessages&&!banned?.sendMessages&&!banned?.sendPlain;
    }
   }catch(e){const value=String(e.errorMessage||e.code||e.message);observation.error=/^[\w:-]{1,120}$/.test(value)?value:'source_entity_unavailable';if(observation.error.startsWith('FLOOD'))accountError=observation.error;}
   row.observations.push(observation);row.status=classifySource(row.observations);snapshot();report('additional_source_checked',{clientId:String(row.id),account:key,status:row.status});if(accountError)break;await sleep(1000);
   }
  }catch(e){const raw=String(e.errorMessage||e.code||e.message);accountError=/^[\w:-]{1,120}$/.test(raw)?raw:'source_account_unavailable';for(const row of pending){row.observations.push({account:key,error:accountError});row.status=classifySource(row.observations);}snapshot();}
  finally{await c.disconnect();releaseSupport?.();}
 }
 snapshot();report('additional_audit_finished',{total:rows.length,healthy:rows.filter(r=>r.status==='healthy').length,broken:rows.filter(r=>r.status==='broken').length,review:rows.filter(r=>r.status==='needs_review').length});
 }finally{release();}
}
module.exports={main,openObserver};
if(require.main===module)main().catch(e=>{report('additional_audit_stopped',{error:/^[\w:-]{1,120}$/.test(e.message)?e.message:'additional_audit_failed'});process.exitCode=1;});
