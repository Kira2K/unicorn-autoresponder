const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {readJson,readRecords}=require('./market.cjs'),{recoverOwnedProfiles}=require('./recovery.cjs');
const {writeJson}=require('./services.cjs');
function alive(pid){if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
async function main(args=process.argv.slice(2)){
  require('./config.cjs').assertNodeVersion();
  const root=path.resolve(__dirname,'../../../..'),input=args.find(a=>a.startsWith('--run-dir='))?.slice(10),apply=args.includes('--apply');
  if(args.some(a=>a!=='--apply'&&!a.startsWith('--run-dir=')&&!a.startsWith('--env-file='))||!input)throw Error('hh_recovery_arguments_invalid');
  const dir=path.resolve(input);
  if(path.dirname(dir)!==path.join(root,'logs')||!/^hh-supervised-[\w-]+$/.test(path.basename(dir)))throw Error('hh_recovery_scope_invalid');
  const owner=readJson(path.join(dir,'owner.json'));if(!owner||owner.runDir!==dir||owner.host!==os.hostname())throw Error('hh_recovery_owner_unverified');
  if(alive(owner.pid))throw Error('hh_recovery_runner_still_active');
  if(apply&&require('./lease.cjs').otherHhProcesses().length)throw Error('hh_recovery_other_runner_active');
  if(owner.lockFile!==require('./lease.cjs').DEFAULT_LOCK)throw Error('hh_recovery_lock_path_invalid');
  const lease=readJson(owner.lockFile);
  if(apply&&(!lease||lease.nonce!==owner.nonce||lease.runDir!==dir))throw Error('hh_recovery_lock_owner_changed');
  const envFile=args.find(a=>a.startsWith('--env-file='))?.slice(11)??path.join(root,'.env');require('dotenv').config({path:envFile,quiet:true});
  let rows=[];
  for(const market of ['Ru','En']){
    const m=readJson(path.join(dir,`manifest-${market}.json`));if(!m)continue;
    if(alive(m.workerPid))throw Error('hh_recovery_worker_still_active');
    if(path.dirname(path.resolve(m.ledger))!==path.join(root,'logs'))throw Error('hh_recovery_ledger_invalid');
    rows.push(...readRecords(m.ledger));
  }
  const p=require('../../../integrations/dolphin/profiles.ts'),{stopDolphinProfile}=require('../../../integrations/dolphin/runtime.ts');
  const readRunning=()=>require('../../../integrations/dolphin/local-api.ts').requestLocalDolphin('/browser_profiles/running',{timeoutMs:5000});
  const proof=await recoverOwnedProfiles(rows,{readProfile:p.getDolphinProfile,readRunning,stop:stopDolphinProfile,removeTag:p.removeDolphinProfileTag,restoreStatus:p.updateDolphinProfileStatus},apply);
  writeJson(path.join(dir,apply?'recovery-applied.json':'recovery-inspection.json'),{at:new Date().toISOString(),...proof});
  if(apply&&proof.cleanupComplete){
    const current=readJson(owner.lockFile);if(current&&current.nonce!==owner.nonce)throw Error('hh_recovery_lock_owner_changed');
    if(current)fs.unlinkSync(owner.lockFile);
    const imageRoot=path.join(root,'tmp/captcha',path.basename(dir));
    if(fs.existsSync(imageRoot)){
      const resolved=fs.realpathSync(imageRoot);
      if(resolved!==imageRoot||path.dirname(resolved)!==path.join(root,'tmp/captcha'))throw Error('hh_recovery_artifact_scope_invalid');
      fs.rmSync(resolved,{recursive:true,force:true});
    }
  }
  console.log(JSON.stringify(proof));return proof.cleanupComplete?0:1;
}
if(require.main===module)main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'hh_recovery_failed');process.exitCode=1;});
module.exports={main};
