const path=require('node:path');const {ROOT,FOLDER,read,save,sleep,report}=require('./live.cjs');const {OUT}=require('./prepare-additional-archive.cjs');const {checkpointReadiness}=require('./checkpoint-readiness.cjs');
async function main(){const plans=read(path.join(OUT,'plans.json')),pid=38272,end=Date.now()+50000;
 while(Date.now()<end){const now=Date.now(),gate=read(path.join(FOLDER,'create-gate.json')),batch=read(path.join(FOLDER,'batch.lock')),own=read(path.join(OUT,'restore.lock')),states=new Map(plans.map(p=>[p.clientId,read(path.join(OUT,'client-'+p.clientId+'.json'))]));
  if(own?.pid!==pid)throw Error('checkpoint_worker_changed');const proof=checkpointReadiness({plans,states,gate,now,pid,batchPid:batch?.pid});
  if(proof.safe&&proof.deadline-Date.now()>1000){save(path.join(OUT,'safe-checkpoint.json'),{...proof,pid,at:new Date().toISOString(),status:'ready'});if(proof.deadline-Date.now()<900)continue;process.kill(pid);await sleep(500);
   for(const q of proof.queued){const file=path.join(OUT,'client-'+q.clientId+'.json'),state=read(file);if(state.channel||state.steps?.create?.intentAt!==q.intentAt)throw Error('checkpoint_state_changed');delete state.steps.create.intentAt;state.creationReconciledAt=new Date().toISOString();state.creationNeverDispatched={gateNextAt:proof.gateNextAt,checkpointPid:pid};save(file,state);}
   save(path.join(OUT,'safe-checkpoint.json'),{...proof,pid,at:new Date().toISOString(),status:'paused_before_next_mutation'});report('additional_checkpoint_complete',{queuedNotDispatched:proof.queued.length});return;
  }await sleep(50);
 }report('additional_checkpoint_not_ready');}
if(require.main===module)main().catch(e=>{report('additional_checkpoint_stopped',{error:e.message});process.exitCode=1});
