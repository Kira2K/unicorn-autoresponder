const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {ROOT,REPO,read,save,sleep,report}=require('./live.cjs');
const OUT=path.join(REPO,'storage/group-restoration-additional');
function alive(pid){try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
async function main(){const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(OUT,'supervisor.lock'));let resumed=false;
 try{for(;;){if(read(path.join(OUT,'completed.json'))){save(path.join(OUT,'supervisor-status.json'),{status:'complete',at:new Date().toISOString()});return;}
  const lock=read(path.join(OUT,'restore.lock'));if(lock&&alive(lock.pid)){save(path.join(OUT,'supervisor-status.json'),{status:'waiting_for_current_pass',pid:lock.pid,resumed,at:new Date().toISOString()});await sleep(50000);continue;}
  const summary=read(path.join(OUT,'report.json')),pending=summary?.groups.filter(g=>!['complete','skipped'].includes(g.status))||[],status=read(path.join(OUT,'restore-status.json'));
  const safe=pending.length&&pending.every(g=>g.error==='FLOOD'||g.error?.startsWith('FLOOD_WAIT_')||g.error==='send_rejected_all_senders_unavailable');
  if(resumed||status?.error!=='additional_groups_incomplete'||!safe){save(path.join(OUT,'supervisor-status.json'),{status:'needs_review',error:status?.error||'unexpected_runner_exit',at:new Date().toISOString()});return;}
  for(const g of pending){const state=read(path.join(OUT,'client-'+g.clientId+'.json'));if(Object.values(state?.deliveries||{}).some(d=>d.intentAt&&!d.done))throw Error('additional_uncertain_send_blocks_resume');}
  const stdout=fs.openSync(path.join(OUT,'restore.out.log'),'a'),stderr=fs.openSync(path.join(OUT,'restore.err.log'),'a');
  const child=spawn(process.execPath,[path.join(__dirname,'restore-additional.cjs')],{cwd:REPO,windowsHide:true,stdio:['ignore',stdout,stderr]});fs.closeSync(stdout);fs.closeSync(stderr);child.unref();resumed=true;
  save(path.join(OUT,'supervisor-status.json'),{status:'resuming_explicit_throttles',pid:child.pid,at:new Date().toISOString()});report('additional_safe_resume_started',{pid:child.pid,pending:pending.length});await sleep(50000);
 }}finally{release();}
}
if(require.main===module)main().catch(e=>{save(path.join(OUT,'supervisor-status.json'),{status:'needs_review',error:/^[\w:-]{1,120}$/.test(e.message)?e.message:'additional_supervisor_failed'});process.exitCode=1;});
