// Read-only Bot API probes. Returns readiness rows with per-target problems;
// sending, group changes and fallback to retired destinations are not available.
async function checkTargetChats(rows,api,save=()=>{}){
 const me=await api.getMeResponse();if(!me?.ok||!Number.isSafeInteger(me.result?.id))throw Error('telegram_bot_identity_unconfirmed');
 const ids=[...new Set(rows.filter(t=>!t.problems.length).map(t=>String(t.commonChatId)))],checks=new Map();
 for(let offset=0;offset<ids.length;offset+=4){
  await Promise.all(ids.slice(offset,offset+4).map(async id=>{
   let problem;
   try{
    const chat=await api.getChatResponse(id);
    if(!chat?.ok)problem=`Telegram client chat unavailable: ${Number(chat?.error_code)||'unknown'} ${String(chat?.description||'invalid response').slice(0,100)}`;
    else{
     const member=await api.getChatMemberResponse(id,me.result.id);
     if(!member?.ok)problem=`Telegram bot membership unavailable: ${Number(member?.error_code)||'unknown'}`;
     else if(['left','kicked'].includes(member.result.status)||(member.result.status==='restricted'&&member.result.is_member===false)||member.result.can_send_messages===false||(chat.result.permissions?.can_send_messages===false&&!['administrator','creator'].includes(member.result.status))||(chat.result.type==='channel'&&member.result.can_post_messages!==true))problem='Telegram bot cannot send to the current client chat';
    }
   }catch{problem='Telegram client chat read failed; delivery readiness unconfirmed'}
   checks.set(id,{chatId:id,ok:!problem,...(problem?{problem}:{})});
  }));
 }
 save({at:new Date().toISOString(),botId:me.result.id,chats:[...checks.values()]});
 return rows.map(t=>{const result=checks.get(String(t.commonChatId));return result?.problem?{...t,problems:[...t.problems,result.problem]}:t});
}
module.exports={checkTargetChats};
