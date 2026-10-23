const path=require('node:path');
function collectTargets(batches,read){
 const seen=new Set(),result=[];
 for(const folder of batches)for(const plan of read(path.join(folder,'plans.json'))||[]){
  const stateFile=path.join(folder,plan.clientId==='92'&&folder.endsWith('group-restoration-v2')?'galina-preserved.json':'client-'+plan.clientId+'.json');
  const state=read(stateFile);if(!state?.chatId||state.skipped||!state.invitation||!(state.complete||state.steps?.invite?.done||state.steps?.early_invite?.done))continue;
  if(seen.has(plan.clientId))throw Error('duplicate_restored_target');seen.add(plan.clientId);result.push({plan,stateFile});
 }
 return result;
}
module.exports={collectTargets};
