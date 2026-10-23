// Read-only audit: frozen archive/plans, local receipts, and two restored chats.
const fs=require('node:fs'),path=require('node:path');
const {ROOT,FOLDER,read,save,openCreator,Api,bi,report}=require('./live.cjs');
const {hash}=require('./plan.cjs');
async function main(){
 const frozen=read(path.join(FOLDER,'plans.json')),rebuilt=require('./archive.cjs').loadPlans(ROOT);
 const issues=[],files=new Map();let sent=0,ownerSent=0,complete=1,existingIncomplete=0,uncreated=0;
 for(const p of frozen){
  if(rebuilt.find(r=>r.clientId===p.clientId)?.planHash!==p.planHash)issues.push({clientId:p.clientId,code:'frozen_plan_differs_from_archive'});
  const {planHash,...body}=p;if(hash(JSON.stringify(body))!==planHash)issues.push({clientId:p.clientId,code:'frozen_hash_invalid'});
  const keys=new Set();for(const op of p.operations){if(keys.has(op.key)||hash(op.text)!==op.hash)issues.push({clientId:p.clientId,code:'duplicate_key_or_corrupt_text'});keys.add(op.key);if(op.file)files.set(op.file.path,op.file);}
  if(p.clientId==='92')continue;
  const s=read(path.join(FOLDER,'client-'+p.clientId+'.json'));
  if(s?.completedAt)complete++;else if(s?.channel)existingIncomplete++;else uncreated++;
  if(!s)continue;
  if(s.planHash!==p.planHash)issues.push({clientId:p.clientId,code:'journal_plan_mismatch'});
  const ids=new Set();let gap=false;
  for(const op of p.operations){const d=s.deliveries?.[op.key];if(!d?.done){gap=true;continue;}sent++;if(d.result.senderId==='8805256389')ownerSent++;
   if(gap||d.hash!==op.hash||ids.has(d.result.messageId))issues.push({clientId:p.clientId,code:'receipt_order_hash_or_duplicate'});ids.add(d.result.messageId);
  }
  if(Object.keys(s.deliveries||{}).some(k=>!keys.has(k)))issues.push({clientId:p.clientId,code:'unexpected_delivery'});
 }
 for(const [file,f] of files){if(fs.statSync(file).size!==f.bytes||hash(fs.readFileSync(file))!==f.sha256)issues.push({code:'archive_attachment_changed'});}
 const live=[];const c=openCreator();
 try{await c.connect();if(String((await c.getMe()).id)!=='8805256389')throw Error('creator_mismatch');
  for(const id of ['63','186']){
   const p=frozen.find(p=>p.clientId===id),s=read(path.join(FOLDER,'client-'+id+'.json'));
   const peer=new Api.InputPeerChannel({channelId:bi(s.channel.id),accessHash:bi(s.channel.accessHash)}),rows=[];
   for await(const m of c.iterMessages(peer,{}))rows.push(m);
   const copies=require('./verify.cjs').restoredCopies(p,rows);
   for(let i=0;i<copies.length;i++){const receipt=s.deliveries[p.operations[i].key].result;if(copies[i].id!==receipt.messageId||String(copies[i].senderId)!==(receipt.senderId||'8897025258'))issues.push({clientId:id,code:'live_receipt_or_author_mismatch'});}
   live.push({clientId:id,messages:copies.length,ownerMessages:copies.filter(m=>String(m.senderId)==='8805256389').length,verified:true});
  }
 }finally{await c.disconnect();}
 const result={at:new Date().toISOString(),plans:frozen.length,complete,existingIncomplete,uncreated,receipts:sent,ownerSent,attachmentsVerified:files.size,live,issues};
 save(path.join(FOLDER,'content-audit.json'),result);report('content_audit',result);
 if(issues.length)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{report('content_audit_failed',{code:e.errorMessage||e.code||'audit_failed'});process.exitCode=1;});
