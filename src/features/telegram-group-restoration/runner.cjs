const {concurrency:maximumConcurrency,perChatDelayMs}=require('./limits.cjs');
async function runJob(plan,state,a){
 if(state.planHash&&state.planHash!==plan.planHash)throw Error('plan_changed');
 state.planHash=plan.planHash;state.steps||={};state.deliveries||={};
 async function step(name,action){const s=state.steps[name]||={};if(s.done)return s.result;const uncertain=!!s.intentAt;s.intentAt||=Date.now();await a.save();try{s.result=await action(uncertain);}catch(e){if(e.errorMessage==='FLOOD'||/^FLOOD_WAIT_\d+$/.test(e.errorMessage||'')){delete s.intentAt;await a.save();}throw e;}s.done=true;await a.save();return s.result;}
 for(const name of ['preflight','create','history','bot','bot_admin','avatar','mute','early_invite','unicorn_join_early'])await step(name,u=>a.stage(name,u));
 await a.prepared?.(state);
 for(const op of plan.operations){
  let d=state.deliveries[op.key];
  if(!d?.done){
   if(d?.intentAt){const r=await a.reconcile(op);if(!r)throw Error('send_outcome_unresolved');d.result=r;d.done=true;state.nextSendAt=Date.now()+perChatDelayMs;await a.save();}
   else{
    await a.sleep(Math.max(0,(state.nextSendAt||0)-Date.now()));
    d=state.deliveries[op.key]={intentAt:Date.now(),hash:op.hash};await a.save();
    for(;;){const r=await a.send(op);
     if(r.retryAfter!==undefined){if(!Number.isFinite(r.retryAfter)||r.retryAfter<0)throw Error('invalid_retry_after');delete d.intentAt;await a.save();await a.sleep((r.retryAfter+1)*1000);d.intentAt=Date.now();await a.save();continue;}
     if(r.rejected){delete d.intentAt;await a.save();throw Error('send_rejected_'+r.code);}
     if(!r.messageId)throw Error('send_outcome_unresolved');d.result=r;d.done=true;state.nextSendAt=Date.now()+perChatDelayMs;await a.save();break;
    }
   }
  }
  if(op.pin)await step('pin:'+op.key,()=>a.pin(op,d.result));
 }
 for(const name of ['verify','invite','sql','bot_admin_restore','final_verify','unicorn_join'])await step(name,u=>a.stage(name,u));
 state.completedAt=new Date().toISOString();await a.save();return state;
}
function ordered(jobs){return [...jobs].sort((a,b)=>a.sourceMessages-b.sourceMessages||Number(a.clientId)-Number(b.clientId));}
async function runQueue(jobs,run,concurrency=maximumConcurrency){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>maximumConcurrency)throw Error('invalid_concurrency');
 let cursor=0;const results=[];
 await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},async()=>{for(;;){const i=cursor++;if(i>=jobs.length)return;try{await run(jobs[i]);results[i]={clientId:jobs[i].clientId,ok:true};}catch(e){results[i]={clientId:jobs[i].clientId,ok:false,code:e.errorMessage||e.code||e.message};}}}));return results;
}
module.exports={runJob,ordered,runQueue};
