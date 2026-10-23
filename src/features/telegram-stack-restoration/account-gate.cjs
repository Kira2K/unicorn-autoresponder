const {deadline}=require('./policy.cjs');
function accountGate({load,save,sleep,now=Date.now,onWait=()=>{},delay=500}){let tail=Promise.resolve();
 return action=>{const task=tail.catch(()=>{}).then(async()=>{for(;;){const state=load()||{};if(state.stopAccount)throw Object.assign(Error('account_stopped_after_bare_flood'),{code:'ACCOUNT_FLOOD_STOPPED'});while((state.nextAt||0)>now())await sleep(Math.min(50000,state.nextAt-now()));try{const r=await action();await save({nextAt:now()+delay});return r;}catch(e){const d=deadline(e,now());if(d.stopAccount){await save({...d,at:now()});throw e;}if(d.retryAt){await save({...d,nextAt:d.retryAt});await onWait(d);continue;}throw e;}}});tail=task;return task;};
}
module.exports={accountGate};
