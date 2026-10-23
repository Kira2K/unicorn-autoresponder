const path=require('node:path');
const {REPO,read,save}=require('./live.cjs');
const {hash}=require('./plan.cjs');
function inspect(plan,state){
 const issues=[];
 if(state.skipped)return {status:'skipped',issues};
 if(state.preserved&&state.complete)return {status:'complete',issues};
 if(state.planHash!==plan.planHash)issues.push('plan_mismatch');
 const ids=new Set();let gap=false;
 for(const op of plan.operations){
  const d=state.deliveries?.[op.key];
  if(!d?.done){gap=true;if(state.completedAt)issues.push('completed_missing_delivery');continue;}
  if(gap)issues.push('delivery_after_gap');
  if(d.hash!==op.hash||hash(op.text)!==op.hash)issues.push('hash_mismatch');
  if(ids.has(d.result.messageId))issues.push('duplicate_receipt');ids.add(d.result.messageId);
  if(state.completedAt&&op.pin&&!state.steps?.['pin:'+op.key]?.done)issues.push('completed_missing_pin');
 }
 if(state.completedAt&&(!state.steps?.final_verify?.done||!state.steps.final_verify.result.historyVisible))issues.push('final_verification_missing');
 return {status:state.completedAt?'complete':'pending',issues:[...new Set(issues)]};
}
function main(){
 const groups=[];
 for(const folder of ['storage/group-restoration-v2','storage/group-restoration-additional'])for(const p of read(path.join(REPO,folder,'plans.json'))){
  const state=read(path.join(REPO,folder,p.clientId==='92'&&folder.endsWith('-v2')?'galina-preserved.json':'client-'+p.clientId+'.json'))||{};
  groups.push({clientId:p.clientId,...inspect(p,state)});
 }
 const result={at:new Date().toISOString(),total:groups.length,complete:groups.filter(g=>g.status==='complete').length,skipped:groups.filter(g=>g.status==='skipped').length,pending:groups.filter(g=>g.status==='pending').length,issues:groups.filter(g=>g.issues.length),groups};
 save(path.join(REPO,'storage/group-restoration-additional/all-ledgers-audit.json'),result);
 if(result.issues.length)throw Error('restoration_ledger_issues');return result;
}
module.exports={inspect,main};
if(require.main===module){const r=main();console.log(JSON.stringify({complete:r.complete,pending:r.pending,skipped:r.skipped,issues:r.issues.length}));}
