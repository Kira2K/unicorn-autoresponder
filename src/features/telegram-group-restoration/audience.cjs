const {hash}=require('./plan.cjs');
const normalize=s=>String(s||'').trim().replace(/^@/,'').toLowerCase();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function buildAudience({members,users,clients,staffIds,staffTags=[],studentIds=[],ignoredIds=[],groups}){
 const excluded=new Set(['415009258','1343900712','8805256389','8897025258','8222949251',...studentIds.map(String),...ignoredIds.map(String)]);
 const studentTags=new Set(clients.map(c=>normalize(c.telegram_personal_chat_id)).filter(Boolean));
 const staff=new Set(staffIds.map(String)),knownStaffTags=new Set(staffTags.map(normalize));
 const sections=new Map(),unresolved=new Map();
 for(const m of members){const id=String(m.user_id),u=users.get(id);if(excluded.has(id))continue;
  if(u?.type?._==='userTypeBot'||u?.type?._==='userTypeDeleted'||u?.is_bot)continue;
  const tags=[...(u?.usernames?.active_usernames||[]),u?.username].filter(Boolean).map(normalize);
  if(tags.some(t=>studentTags.has(t)))continue;
  if(!u||(!staff.has(id)&&!tags.some(t=>knownStaffTags.has(t)))){unresolved.set(id,{id,name:[u?.first_name,u?.last_name].filter(Boolean).join(' '),usernames:tags});continue;}
  const group=groups.get(String(m.chat_id));if(!group?.invitation)throw Error('recipient_group_incomplete');
  const section=sections.get(id)||{id,name:[u.first_name,u.last_name].filter(Boolean).join(' ')||id,username:tags[0]||'',groups:[]};
  if(!section.groups.some(g=>g.clientId===group.clientId))section.groups.push(group);sections.set(id,section);
 }
 const people=[...sections.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
 const html='<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Восстановленные группы VEU</title><style>body{font:17px/1.6 system-ui;max-width:900px;margin:30px auto;padding:0 20px}section{border-top:1px solid #ddd;padding:16px 0}a{color:#2756b8}small{color:#555}</style><h1>Приглашения в восстановленные группы VEU</h1><p><strong>Общие группы по стекам пока не созданы.</strong></p><p>Найди своё имя или Telegram-тег поиском по странице. Ниже — ссылки на группы, в которых ты участвовал(а).</p>'+people.map(p=>'<section><h2>'+escape(p.name)+(p.username?' — @'+escape(p.username):'')+'</h2><small>Telegram ID: '+escape(p.id)+'</small><ul>'+p.groups.sort((a,b)=>a.title.localeCompare(b.title,'ru')).map(g=>'<li><a href="'+escape(g.invitation)+'">'+escape(g.title)+'</a></li>').join('')+'</ul></section>').join('')+'</html>';
 return {people,unresolved:[...unresolved.values()],html,sha256:hash(html)};
}
module.exports={buildAudience};
