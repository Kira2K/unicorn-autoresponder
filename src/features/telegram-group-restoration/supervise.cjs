const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {FOLDER,ROOT,REPO,read,save,sleep,report}=require('./live.cjs');
function nextAction(states){
 const unfinished=states.filter(s=>!require('./graduates.cjs').terminal(s));
 const blocked=unfinished.filter(s=>s.lastError&&!/^(FLOOD(?:_WAIT_\d+)?|EPERM|EACCES|EBUSY)$/.test(s.lastError));
 return blocked.length?{action:'blocked',clients:blocked.map(s=>({clientId:s.clientId,code:s.lastError}))}:{action:'resume'};
}
function alive(pid){try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
async function main(){
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'supervisor.lock'));
 try{
  for(let pass=0;pass<192;pass++){
   const current=read(path.join(FOLDER,'batch.lock'));
   if(current&&alive(current.pid)){report('waiting_for_existing_batch',{pid:current.pid});while(alive(current.pid))await sleep(30000);}
   if(read(path.join(FOLDER,'completed.json'))){report('supervisor_complete');return;}
   const plans=read(path.join(FOLDER,'plans.json'));
   const states=plans.map(p=>p.clientId==='92'?read(path.join(FOLDER,'galina-preserved.json')):read(path.join(FOLDER,'client-'+p.clientId+'.json'))||{clientId:p.clientId});
   const decision=nextAction(states);
   if(decision.action==='blocked'){save(path.join(FOLDER,'supervisor-blocked.json'),{at:new Date().toISOString(),...decision});report('supervisor_blocked',decision);return;}
   // Only explicit Telegram rejection or a local file lock is retryable here.
   // Uncertain outcomes are reconciled by the runner, never cleared by this watcher.
   await sleep(900000);
   const out=fs.openSync(path.join(FOLDER,'supervised-'+pass+'.out.log'),'a',0o600),err=fs.openSync(path.join(FOLDER,'supervised-'+pass+'.err.log'),'a',0o600);
   try{
    const child=spawn(process.execPath,[path.join(__dirname,'batch.cjs'),'--run'],{cwd:REPO,windowsHide:true,env:{...process.env,RESTORATION_BOT_ADMIN:'0'},stdio:['ignore',out,err]});
    save(path.join(FOLDER,'supervisor-status.json'),{at:new Date().toISOString(),pass,pid:child.pid,mode:'owner'});
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
   }finally{fs.closeSync(out);fs.closeSync(err);}
  }
  report('supervisor_retry_limit');
 }finally{release();}
}
module.exports={nextAction};
if(require.main===module)main().catch(e=>{report('supervisor_failed',{code:/^[\w:-]+$/.test(e.code||'')?e.code:'operation_failed'});process.exitCode=1;});
