const SELECT='SELECT id,telegram_general_chat_id,telegram_personal_chat_id,secured_general_chat_id,secured_general_chat_invitation_link FROM noco.clients WHERE id=$1';
const {normalizeChatId}=require('./identity.cjs');
async function bindSecured(db,plan,state){
 await db.query('BEGIN READ WRITE');
 try{
  await db.query("SET LOCAL lock_timeout='5s'");
  const row=(await db.query(SELECT+' FOR UPDATE',[plan.clientId])).rows[0];
  if(!row||normalizeChatId(row.telegram_general_chat_id)!==plan.sourceChatId||row.telegram_personal_chat_id!==state.previous.telegram_personal_chat_id)throw Error('source_changed');
  const already=row.secured_general_chat_id===state.chatId&&row.secured_general_chat_invitation_link===state.invitation;
  if(!already&&(row.secured_general_chat_id!==state.previous.secured_general_chat_id||row.secured_general_chat_invitation_link!==state.previous.secured_general_chat_invitation_link))throw Error('secured_fields_changed');
  if((await db.query('SELECT id FROM noco.clients WHERE secured_general_chat_id=$1 AND id<>$2',[state.chatId,plan.clientId])).rows.length)throw Error('group_assigned_elsewhere');
  if(!already){const r=await db.query('UPDATE noco.clients SET secured_general_chat_id=$1,secured_general_chat_invitation_link=$2 WHERE id=$3 RETURNING id',[state.chatId,state.invitation,plan.clientId]);if(r.rowCount!==1)throw Error('update_count_mismatch');}
  await db.query('COMMIT');
  const saved=(await db.query(SELECT,[plan.clientId])).rows[0];
  if(saved.secured_general_chat_id!==state.chatId||saved.secured_general_chat_invitation_link!==state.invitation)throw Error('commit_unverified');
  return{clientId:plan.clientId};
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
}
module.exports={bindSecured};
