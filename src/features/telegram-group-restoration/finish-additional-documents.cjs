// Explicitly requested follow-up: wait for verified restoration, then one document album.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {ROOT,REPO,read,save,sleep,report}=require('./live.cjs');
const {OUT}=require('./prepare-additional-archive.cjs');
const {DIR}=require('./refresh-mentor-documents.cjs');
const DELIVERY=path.join(DIR,'delivery.json');
const CAPTION=require('./mentor-documents-delivery.cjs').CAPTION+'\n\nПроверила ещё 30 групп: добавила 27, три работающие группы сохранила. Проверьте менторов и позовите в группы сегодня обязательно, ссылки все в доках есть.';
async function main(){
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(OUT,'documents-followup.lock'));
 try{
  for(;;){
   const r=read(path.join(OUT,'report.json'));
   if(r?.status==='complete'&&r.groups.length===27&&r.groups.every(g=>g.status==='complete'))break;
   if(r?.status==='needs_review'||read(path.join(OUT,'restore-status.json'))?.status==='blocked')throw Error('documents_waiting_for_restoration_review');
   save(path.join(OUT,'documents-status.json'),{at:new Date().toISOString(),status:'waiting_restoration'});await sleep(50000);
  }
  if(!read(DELIVERY)?.album?.intent){
   const all=require('./audit-restoration-ledgers.cjs').main();if(all.pending||all.complete!==134||all.skipped!==7)throw Error('all_restorations_not_ready');
   await require('./audit-additional-complete.cjs').main();
   await require('./refresh-mentor-documents.cjs').main();
   if(read(path.join(DIR,'preparation.json')).verifiedInvitations!==134)throw Error('unified_invitation_count_mismatch');
   const scripts='C:/Users/kiras/.codex/plugins/cache/openai-curated-remote/data-analytics/0.2.10-13ceeea1f599/skills/build-report/scripts/';
   const {verifyPortableArtifactStructure}=await import('file:///'+scripts+'verify_portable_artifact.mjs');
   const checks=[];
   for(const name of ['01-sql','02-groups','04-differences-filtered']){
    const base=path.join(DIR,name),result=spawnSync(process.execPath,[scripts+'build_portable_artifact.mjs','--input',base+'.artifact.json','--output',base+'.html'],{cwd:REPO,encoding:'utf8',windowsHide:true});
    if(result.status!==0)throw Error('unified_report_build_failed');
    const checked=verifyPortableArtifactStructure({artifactPath:base+'.artifact.json',htmlPath:base+'.html'});checks.push({name,result:checked});
   }
   save(path.join(DIR,'verification.json'),{at:new Date().toISOString(),structure:checks,sourceCoverage:141,verifiedInvitations:134,sqlReadOnly:true,browserVerification:'Existing portable report format retained; semantic fallback and embedded datasets structurally verified.'});
  }
  for(;;){try{await require('./mentor-documents-delivery.cjs').main({albumOnly:true,documentFolder:DIR,receiptFile:DELIVERY,caption:CAPTION});break;}catch(e){if(e.message!=='restoration_already_running')throw e;await sleep(50000);}}
  if(!read(DELIVERY)?.album?.done)throw Error('unified_album_not_verified');
  save(path.join(OUT,'documents-status.json'),{at:new Date().toISOString(),status:'complete',messageIds:read(DELIVERY).album.messageIds});report('unified_documents_complete',{messageIds:read(DELIVERY).album.messageIds});
 }finally{release();}
}
module.exports={main,CAPTION};
if(require.main===module)main().catch(e=>{save(path.join(OUT,'documents-status.json'),{at:new Date().toISOString(),status:'blocked',error:/^[\w:-]+$/.test(e.message)?e.message:'documents_failed'});report('unified_documents_stopped',{error:/^[\w:-]+$/.test(e.message)?e.message:'documents_failed'});process.exitCode=1;});
