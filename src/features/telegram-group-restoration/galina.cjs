const path=require('node:path');
const {hash,NOTICE}=require('./plan.cjs');
const {ROOT,FOLDER,read,save,report,openDb,rpc,Api,BOT}=require('./live.cjs');
async function auditGalina(c,telegram){
 const file=path.join(FOLDER,'galina-preserved.json'),previous=read(file);
 if(previous?.complete)return previous;
 const state=read(ROOT+'/runtime/restoration/client-92.json');
 if(!state?.completedAt)throw Error('galina_existing_restoration_running');
 const plan=read(ROOT+'/runtime/restoration/client-92-plan.json');
 const target=await require(ROOT+'/tools/restoration-migrated.cjs').openMigratedTarget(c,state.migrationAuthorization);
 const full=await target.full();if(full.fullChat.hiddenPrehistory)throw Error('galina_history_hidden');
 const all=[];for(const peer of [target.oldPeer,target.peer])for await(const m of c.iterMessages(peer,{}))if(m.className==='Message'&&String(m.senderId)===BOT)all.push(m);
 const expected=new Map();for(const op of plan.operations)expected.set(op.hash,(expected.get(op.hash)||0)+1);
 for(const [h,n]of expected)if(all.filter(m=>hash(m.message||'')===h).length!==n)throw Error('galina_history_mismatch');
 const pin=plan.operations.find(o=>o.pin),pinReceipt=state.deliveries[pin.key];
 if(full.fullChat.pinnedMsgId!==pinReceipt.result.observerId)throw Error('galina_pin_mismatch');
 const db=await openDb();try{const row=(await db.query('SELECT id,telegram_general_chat_id,secured_general_chat_id,secured_general_chat_invitation_link FROM noco.clients WHERE id=92')).rows[0];if(row.secured_general_chat_id!==target.chatId||row.secured_general_chat_invitation_link!==state.invitation||row.telegram_general_chat_id!==plan.sourceChatId)throw Error('galina_sql_mismatch');}finally{await db.end();}
 const invite=await rpc(c,new Api.messages.CheckChatInvite({hash:state.invitation.split('/').at(-1).replace(/^\+/, '')}));if(String(invite.chat?.id)!==state.migrationAuthorization.channelId)throw Error('galina_invitation_mismatch');
 const notices=all.filter(m=>hash(m.message||'')===hash(NOTICE));if(notices.length>1)throw Error('duplicate_galina_notice');
 if(!notices.length){if(previous?.noticeIntent)throw Error('galina_notice_outcome_unresolved');save(file,{noticeIntent:true});const r=await telegram.sendOne({chatId:target.chatId,text:NOTICE});if(r.kind!=='telegram-response'||!r.response.ok)throw Error('galina_notice_unresolved');}
 const result={complete:true,clientId:'92',sourceChatId:plan.sourceChatId,title:plan.title,chatId:target.chatId,invitation:state.invitation,preserved:true,historyVisible:true,messages:plan.operations.length,pins:1};save(file,result);report('galina_verified_preserved',{chatId:target.chatId,messages:plan.operations.length});return result;
}
module.exports={auditGalina};
