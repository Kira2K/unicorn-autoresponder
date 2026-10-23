const MARKET=new Set(['on ru market','on en market']);
function selectMarket(rows,restored){
 const targets=[],skipped=[];const byClient=new Map(restored.map(t=>[String(t.clientId),t]));
 for(const row of rows){if(!MARKET.has(row.client_status))continue;const id=String(row.id),chatId=String(row.secured_general_chat_id||'').trim(),t=byClient.get(id);
  if(!chatId){skipped.push({clientId:id,reason:'no_secured_group'});continue;}
  if(!t||t.chatId!==chatId){skipped.push({clientId:id,reason:'not_restored_target'});continue;}targets.push({...t,statusAtSelection:row.client_status});
 }return{targets,skipped};
}
function assertTarget(t,row,state){
 if(String(row?.id)!==t.clientId||String(row?.secured_general_chat_id||'').trim()!==t.chatId||state?.clientId!==t.clientId||state.chatId!==t.chatId||state.skipped||!(state.completedAt||state.complete)||state.planHash&&state.planHash!==t.planHash)throw Error('secured_scope_changed');
}
function authorizedTransfer(scope,targets){
 if(scope.from!=='7586552066'||scope.to!=='8805256389'||!targets.some(t=>t.clientId===scope.clientId&&t.chatId===scope.chatId&&t.planHash===scope.planHash))throw Error('unauthorized_handoff_scope');return scope;
}
module.exports={MARKET,selectMarket,assertTarget,authorizedTransfer};
