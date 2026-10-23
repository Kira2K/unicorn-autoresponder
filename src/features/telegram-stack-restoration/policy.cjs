const STACKS=Object.freeze([
 {key:'java',name:'Java',sqlStackIds:['5']},
 {key:'go',name:'Go',sqlStackIds:['7']},
 {key:'devops',name:'DevOps',sqlStackIds:['8']},
 {key:'aqa',name:'AQA',sqlStackIds:['13','18']}
]);
const ACTIVE=new Set(['studying','onboarding','on ru market','on en market']);
const ACCOUNTS=Object.freeze({owner:'8805256389',observer:'7586552066',source:'8222949251'});
function stackFor(row){return STACKS.find(s=>s.sqlStackIds.includes(String(row?.stack_id)));}
function audience(rows){return rows.flatMap(row=>{const stack=stackFor(row);return stack?[{clientId:String(row.id),stackKey:stack.key,status:row.client_status,eligible:ACTIVE.has(row.client_status),reason:ACTIVE.has(row.client_status)?null:'excluded_status'}]:[];});}
function target(row){if(!row)return null;const secured=String(row.secured_general_chat_id||'').trim(),original=String(row.telegram_general_chat_id||'').trim();const chatId=secured||original;if(!/^-\d+$/.test(chatId))return null;return{chatId,secured:!!secured};}
function validateRecipient(row,expected){const stack=stackFor(row),destination=target(row);if(!row||String(row.id)!==expected.clientId||!ACTIVE.has(row.client_status)||stack?.key!==expected.stackKey)return{ok:false,reason:'status_or_stack_changed'};if(destination?.chatId!==expected.chatId)return{ok:false,reason:'destination_changed'};return{ok:true};}
function deadline(e,now=Date.now()){const raw=String(e.errorMessage||e.code||e.message),seconds=Number(e.seconds||raw.match(/^FLOOD_WAIT_(\d+)$/)?.[1]||0);return{error:/^[\w:-]{1,120}$/.test(raw)?raw:'external_operation_uncertain',retryAt:seconds>0?now+(seconds+1)*1000:undefined,stopAccount:raw==='FLOOD'||raw==='PEER_FLOOD'};}
const {definiteRejection}=require('./rejection.cjs');
module.exports={STACKS,ACTIVE,ACCOUNTS,audience,target,validateRecipient,deadline,stackFor,definiteRejection};
