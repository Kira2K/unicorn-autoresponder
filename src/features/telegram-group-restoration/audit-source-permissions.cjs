const path=require('node:path'),fs=require('node:fs');
const {ROOT,REPO,FOLDER,Api,bi,read,save,openDb,sleep,report}=require('./live.cjs');
const {openObserver}=require('./audit-additional-sources.cjs'),{textPermission}=require('./text-permission.cjs');
const OUT=path.join(REPO,'storage/group-restoration-additional');
async function main(){
 const manifest=read(path.join(OUT,'manifest.json')),db=await openDb();let clients;
 try{clients=(await db.query('SELECT id,client_name,telegram_personal_chat_id,btrim(telegram_general_chat_id) source_chat_id,btrim(secured_general_chat_id) secured_chat_id FROM noco.clients WHERE id=ANY($1::bigint[]) AND coalesce(__nc_deleted,false)=false',[manifest.clientIds])).rows;}finally{await db.end();}
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock')),supportLock=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'support-join.lock'));
 const c=openObserver('support'),groups=[];
 try{await c.connect();const me=await c.getMe();if(String(me.id)!=='8222949251'||me.username?.toLowerCase()!=='veu_support')throw Error('source_support_identity_mismatch');
 const dialogs=[];for await(const d of c.iterDialogs({}))dialogs.push(d);
 let accountLimit;
 for(const row of clients.sort((a,b)=>Number(b.id==='198')-Number(a.id==='198'))){const result={clientId:String(row.id),name:row.client_name,chatId:row.source_chat_id,at:new Date().toISOString(),status:'needs_review'};
 if(accountLimit){groups.push({...result,status:'waiting',error:accountLimit,notChecked:true});save(path.join(OUT,'permissions-audit.json'),{at:new Date().toISOString(),accountId:'8222949251',sendTestPerformed:false,previousHealthyVerdictWithdrawn:true,groups});continue;}
 try{
  const dialog=dialogs.find(d=>String(d.id)===row.source_chat_id);if(!dialog)throw Error('source_dialog_unavailable');
  const basic=dialog.entity.className==='Chat',full=basic?await c.invoke(new Api.messages.GetFullChat({chatId:dialog.entity.id})):await c.invoke(new Api.channels.GetFullChannel({channel:dialog.inputEntity}));
  const entity=full.chats.find(e=>String(e.id)===String(dialog.entity.id));if(!entity)throw Error('fresh_source_entity_missing');
  result.title=entity.title;result.defaultRestrictions=entity.defaultBannedRights;result.platformRestrictions=entity.restrictionReason;result.deactivated=!!entity.deactivated;
  result.legacyChats=dialogs.filter(d=>d.entity.className==='Chat'&&String(d.entity.migratedTo?.channelId)===String(entity.id)).map(d=>({chatId:String(d.id),title:d.title,deactivated:!!d.entity.deactivated,migratedTo:row.source_chat_id}));
  let members;
  if(basic){members=(full.fullChat.participants?.participants||[]).map(p=>({id:String(p.userId),user:full.users.find(u=>String(u.id)===String(p.userId)),participant:p}));}
  else{members=[];for await(const u of c.iterParticipants(dialog.inputEntity,{}))members.push({id:String(u.id),user:u,participant:u.participant});}
  result.members=members.map(m=>({id:m.id,username:m.user?.username,role:m.participant?.className,text:textPermission(entity,m.participant)}));
  const norm=s=>String(s||'').trim().replace(/^@/,'').toLowerCase(),personal=norm(row.telegram_personal_chat_id);
  const student=members.filter(m=>m.id===personal||personal&&norm(m.user?.username)===personal);result.student=student.length===1?{id:student[0].id,username:student[0].user?.username,text:textPermission(entity,student[0].participant)}:{identity:'unconfirmed',sqlTag:row.telegram_personal_chat_id};
  result.support=result.members.find(m=>m.id==='8222949251');result.bot=result.members.find(m=>m.id==='8897025258');
  await c.getMessages(dialog.inputEntity,{limit:1});result.historyReadable=true;
  result.status=result.deactivated?'current_chat_deactivated':result.platformRestrictions?.length?'platform_restricted':result.members.some(m=>m.text.allowed===false)?'member_write_restriction':'permissions_allow_text_unproven_send';
  if(row.id==='198')result.userReportedWriteDenied=true;
 }catch(e){const raw=String(e.errorMessage||e.code||e.message);result.error=/^[\w:-]{1,120}$/.test(raw)?raw:'source_permission_inspection_failed';if(result.error.startsWith('FLOOD')){accountLimit=result.error;result.status='waiting';}}
 groups.push(result);save(path.join(OUT,'permissions-audit.json'),{at:new Date().toISOString(),accountId:'8222949251',sendTestPerformed:false,previousHealthyVerdictWithdrawn:true,groups});report('source_permissions_checked',{clientId:result.clientId,status:result.status,legacyChats:result.legacyChats?.length||0});await sleep(1000);
 }
 const lines=['Повторная проверка 30 исходных групп','Предыдущий общий вывод «все исправны» отозван: чтение и флаги прав не доказывают успешную отправку.','Сообщения не отправлялись. Проверены свежие сведения, права участников и старые чаты после миграции.',''];
 for(const g of groups)lines.push(g.name+' (ID '+g.clientId+'): '+g.status+'; актуальный чат '+g.chatId+'; старые чаты: '+(g.legacyChats?.map(x=>x.chatId+' — '+(x.deactivated?'деактивирован':'не подтверждено')).join(', ')||'не найдены')+'; ученик: '+(g.student?.identity||g.student?.text?.reason||'не проверен'));
 fs.writeFileSync(path.join(OUT,'permissions-result.txt'),lines.join('\n'),'utf8');
 fs.writeFileSync(path.join(OUT,'result.txt'),'ПРЕЖНИЙ ВЫВОД ОТОЗВАН. Используйте permissions-result.txt и permissions-audit.json: повторная проверка прав и миграций.\n','utf8');
 report('source_permissions_finished',{total:groups.length,legacyGroups:groups.filter(g=>g.legacyChats?.length).length,restricted:groups.filter(g=>g.status==='member_write_restriction').length,review:groups.filter(g=>g.status==='needs_review').length});
 }finally{await c.disconnect();supportLock();release();}
}
if(require.main===module)main().catch(e=>{report('source_permissions_stopped',{error:/^[\w:-]{1,120}$/.test(e.message)?e.message:'source_permissions_failed'});process.exitCode=1;});
