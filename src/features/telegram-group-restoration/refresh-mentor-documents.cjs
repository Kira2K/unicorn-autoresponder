// Private report preparation. Reads SQL and archived memberships; no Telegram writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite');
const {ROOT,REPO,openDb,read,save}=require('./live.cjs');
const {OUT,DATA}=require('./prepare-additional-archive.cjs');
const DIR=path.join(REPO,'storage/mentor-audit-unified');
async function main(){
 fs.mkdirSync(DIR,{recursive:true});
 const db=await openDb();let sql;
 try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');sql={at:new Date().toISOString(),
  mentors:(await db.query('SELECT id,name FROM noco.mentors WHERE coalesce(__nc_deleted,false)=false')).rows,
  links:(await db.query('SELECT mentors_id,"02_clients_id" as client_id FROM noco._nc_m2m_02_clients_mentors')).rows,
  clients:(await db.query('SELECT id,client_name,client_status,telegram_general_chat_id,secured_general_chat_id,secured_general_chat_invitation_link FROM noco.clients WHERE coalesce(__nc_deleted,false)=false')).rows,
  staff:(await db.query('SELECT telegram_user_id,telegram_username,display_name,first_name,last_name FROM noco.users WHERE active=true')).rows};await db.query('COMMIT');
 }finally{await db.end();}
 save(path.join(DIR,'sql-snapshot.json'),sql);
 const merged=path.join(DIR,'memberships.sqlite'),d=new DatabaseSync(merged);
 d.exec('CREATE TABLE IF NOT EXISTS groups(chat_id TEXT PRIMARY KEY,payload TEXT,complete INTEGER);CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,payload TEXT);CREATE TABLE IF NOT EXISTS memberships(chat_id TEXT,user_id TEXT,payload TEXT,PRIMARY KEY(chat_id,user_id));BEGIN;DELETE FROM groups;DELETE FROM users;DELETE FROM memberships;');
 for(const archive of [ROOT+'/archive/archive.sqlite',DATA+'/archive/archive.sqlite']){
  const src=new DatabaseSync(archive,{readOnly:true});
  const groups=src.prepare('SELECT chat_id,payload,complete FROM groups').all().filter(g=>/^\d+$/.test(String(JSON.parse(g.payload).id)));
  const allowed=new Set(groups.map(g=>g.chat_id));
  for(const g of groups)d.prepare('INSERT OR REPLACE INTO groups VALUES(?,?,?)').run(g.chat_id,g.payload,g.complete);
  for(const u of src.prepare('SELECT id,payload FROM users').all())d.prepare('INSERT OR REPLACE INTO users VALUES(?,?)').run(u.id,u.payload);
  for(const m of src.prepare('SELECT chat_id,user_id,payload FROM memberships').all())if(allowed.has(m.chat_id))d.prepare('INSERT OR REPLACE INTO memberships VALUES(?,?,?)').run(m.chat_id,m.user_id,m.payload);
  src.close();
 }
 const groups=d.prepare('SELECT payload,complete FROM groups').all();
 if(groups.length!==141||groups.some(g=>!g.complete))throw Error('mentor_merged_archive_incomplete');
 const ids=groups.map(g=>String(JSON.parse(g.payload).id)),partial=[];
 for(const row of d.prepare('SELECT chat_id,payload FROM groups').all()){
  const g=JSON.parse(row.payload),observed=d.prepare('SELECT count(*) n FROM memberships WHERE chat_id=?').get(row.chat_id).n,expected=g.full?.member_count??g.entity?.member_count;
  if(g.full?.partial||g.full?.memberEnumerationError||Number.isFinite(expected)&&expected!==observed)partial.push({clientId:String(g.id),student:g.client_name,expected:String(expected??'неизвестно'),observed:String(observed),note:'Полнота состава не подтверждена. Присутствие найденных участников подтверждено; отсутствие остальных не утверждается.'});
 }
 const partialIds=new Set(partial.map(g=>g.clientId));d.exec('COMMIT');d.close();save(path.join(DIR,'coverage.json'),ids);save(path.join(DIR,'membership-quality.json'),partial);
 const run=(source,filename)=>vm.runInNewContext(source,{require:require('node:module').createRequire(path.join(REPO,filename)),console,process,Buffer},{filename});
 let build=fs.readFileSync(path.join(REPO,'build-mentor-audit.cjs'),'utf8')
  .replace("const folder='storage/mentor-audit'","const folder='storage/mentor-audit-unified'")
  .replace("ROOT+'/archive/archive.sqlite'",JSON.stringify(merged))
  .replaceAll('114','141')
  .replace('Заново сформированный документ по текущим SQL-связям. Ранее созданный файл найти не удалось; его происхождение не подтверждено.','Актуальный снимок SQL-связей учеников и менторов.')
  .replace('14–15 октября','14–16 октября');
 run(build,'build-mentor-audit.cjs');
 const dataFile=path.join(DIR,'audit-data.json'),audit=read(dataFile);
 for(const diff of audit.differences)if(partialIds.has(diff.clientId)&&diff.kind.startsWith('SQL: связь лишняя')){diff.kind='Требуется проверка полноты состава';diff.detail='SQL-связь сохранена: ментор не найден в полученном списке, но количество перечисленных участников меньше счётчика Telegram. Нельзя считать связь ошибочной без проверки.';}
 save(dataFile,audit);
 const diffFile=path.join(DIR,'03-differences.artifact.json'),diffArtifact=read(diffFile);diffArtifact.snapshot.datasets.data0=audit.differences.filter(r=>r.kind.startsWith('SQL:'));diffArtifact.snapshot.datasets.data1=audit.differences.filter(r=>!r.kind.startsWith('SQL:'));save(diffFile,diffArtifact);
 run(fs.readFileSync(path.join(REPO,'storage/mentor-audit/add-chart.cjs'),'utf8').replaceAll('storage/mentor-audit/','storage/mentor-audit-unified/'),'add-chart-unified.cjs');
 let filtered=fs.readFileSync(path.join(REPO,'storage/mentor-audit/build-filtered.cjs'),'utf8')
  .replace("const dir='storage/mentor-audit'","const dir='storage/mentor-audit-unified'")
  .replace("JSON.parse(fs.readFileSync('storage/group-restoration-v2/plans.json')).map(r=>String(r.clientId))","JSON.parse(fs.readFileSync('storage/mentor-audit-unified/coverage.json'))");
 run(filtered,'build-filtered-unified.cjs');
 // Only audited, completed restored groups contribute invitations. Never invent links.
 const verified=[];
 for(const folder of ['storage/group-restoration-v2','storage/group-restoration-additional']){
  for(const p of read(path.join(REPO,folder,'plans.json'))){
   const s=read(path.join(REPO,folder,p.clientId==='92'&&folder.endsWith('-v2')?'galina-preserved.json':'client-'+p.clientId+'.json'));if(!s?.completedAt&&!s?.complete)continue;
   const c=sql.clients.find(c=>String(c.id)===String(p.clientId));
   if(!c||c.secured_general_chat_id!==s.chatId||c.secured_general_chat_invitation_link!==s.invitation)throw Error('mentor_invitation_sql_mismatch');
   if(!/^https:\/\/t\.me\/(\+|joinchat\/)[A-Za-z0-9_-]+$/.test(s.invitation))throw Error('mentor_invitation_invalid');
   verified.push({clientId:String(c.id),student:c.client_name,chatId:s.chatId,link:s.invitation});
  }
 }
 if(new Set(verified.map(v=>v.clientId)).size!==verified.length)throw Error('mentor_duplicate_group');
 verified.sort((a,b)=>a.student.localeCompare(b.student,'ru'));
 const byId=new Map(verified.map(v=>[v.clientId,v]));
 const markdown=s=>String(s).replace(/[\[\]\\*`<>]/g,' ');
 for(const name of ['01-sql','02-groups','04-differences-filtered']){
  const file=path.join(DIR,name+'.artifact.json'),a=read(file);
  a.manifest.generatedAt=sql.at;a.snapshot.generatedAt=sql.at;
  a.manifest.sources=a.manifest.sources.map(s=>({...s,path:s.id==='sql'?'sql-snapshot.json':'memberships.sqlite'}));
  a.sources=a.sources.map(s=>({...s,path:s.id==='sql'?'sql-snapshot.json':'memberships.sqlite'}));
  for(const rows of Object.values(a.snapshot.datasets))for(const r of rows){if(r.clientId){r.invitation=byId.get(String(r.clientId))?.link||'Нет проверенного приглашения восстановленной группы';if(partialIds.has(String(r.clientId))){if(r.coverage)r.coverage='Архив есть, полнота состава не подтверждена';if(r.archive)r.archive='Архив есть, полнота состава не подтверждена';}}}
  for(const table of a.manifest.tables)if(a.snapshot.datasets[table.dataset]?.some(r=>r.clientId))table.columns.push({field:'invitation',label:'Приглашение в группу',type:'text'});
  a.manifest.blocks.push({id:'unified-invites',type:'markdown',body:'## Все восстановленные группы: приглашения\n\nЕдиный список без разделения по партиям. '+verified.length+' проверенных приглашений. Менторов нужно приглашать в соответствующие группы. Общие группы по стекам пока не созданы.\n\n'+verified.map(v=>'- ['+markdown(v.student)+' (ID '+v.clientId+')]('+v.link+')').join('\n')});
  a.manifest.blocks.find(b=>b.id==='scope').body+='\n\nОбъединены архивы 141 исходной группы: старое восстановление и дополнительная проверка. Из последних 30 проверенных групп 27 восстановлены, три работающие исходные группы не пересоздавались. Состав новых групп с ботом не используется для определения менторов. Приглашения относятся к проверенным восстановленным группам; отсутствие приглашения не означает отсутствие исходной группы. Ученики без ментора допустимы.';
  const summary=a.manifest.blocks.find(b=>b.id==='summary');summary.body='## Главное\n\n'+summary.body+'\n\n**Действие сегодня:** проверьте назначения менторов и пригласите их в соответствующие группы по ссылкам ниже. Ученики без назначенного ментора допустимы; автоматически назначать их не требуется.';
  a.snapshot.datasets.membershipQuality=partial.map(r=>({...r,invitation:byId.get(r.clientId)?.link||'Нет проверенного приглашения'}));
  a.manifest.tables.push({id:'membershipQuality',title:'Полнота состава требует проверки',dataset:'membershipQuality',sourceId:'archive',columns:[['student','Ученик'],['clientId','ID'],['expected','Счётчик Telegram'],['observed','Участников в архиве'],['note','Ограничение'],['invitation','Приглашение']].map(([field,label])=>({field,label,type:'text'}))});
  a.manifest.blocks.push({id:'membership-quality-note',type:'markdown',body:'## Полнота состава требует проверки\n\nУ '+partial.length+' групп число перечисленных участников не совпало со счётчиком Telegram. Отсутствие ментора в этих списках не используется как доказательство лишней SQL-связи. Наблюдаемые участники остаются в документе состава.'},{id:'membership-quality-table',type:'table',tableId:'membershipQuality'});
  a.manifest.blocks.push({id:'next-actions',type:'markdown',body:'## Что проверить сегодня\n\n1. Сверить назначения SQL с архивным присутствием менторов в группах.\n2. Неопределённые личности сопоставить вручную; отсутствие архива не считать ошибкой назначения.\n3. Пригласить нужных менторов по проверенным ссылкам. Наличие ученика без ментора само по себе допустимо.'});
  a.package_info.notes='Обновлённая объединённая версия прежних трёх документов; SQL только SELECT в read-only snapshot. Архивный состав — основание отношений, проверенные SQL-ссылки — навигация. Лиза/Влада/KiraSamsonova исключены только из третьего документа. Таблицы сохранены для точного аудита.';
  save(file,a);
 }
 save(path.join(DIR,'preparation.json'),{at:sql.at,archiveGroups:141,verifiedInvitations:verified.length,additionalCreated:27,additionalWorkingUnchanged:3,complete:read(path.join(OUT,'completed.json'))?.restored===27});
 console.log(JSON.stringify({event:'unified_mentor_docs_prepared',archiveGroups:141,verifiedInvitations:verified.length}));
}
module.exports={main,DIR};
if(require.main===module)main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
