const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const NOTICE='Привет! Telegram заблокировал некоторые наши группы по независящим от нас причинам. Нам удалось восстановить доступную историю переписки через API. Надеемся, это не доставит тебе лишних неудобств.\n\nОбрати внимание на даты и теги в восстановленных сообщениях — они помогут ориентироваться в переписке. Твои менторы скоро присоединятся к группе.\n\nПо всем вопросам пиши @veu_support — она постарается помочь как можно скорее!';
function buildPlan({group,messages,users,cutoff,renderParts,media,currentPinnedId,notice=NOTICE,endDate=Infinity}){
 const byDate=(a,b)=>a.date-b.date||(BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
 const pins=messages.filter(m=>m.pinned).sort(byDate);
 const current=currentPinnedId===undefined?pins.at(-1):currentPinnedId===null?null:messages.find(m=>String(m.id)===String(currentPinnedId));
 if(currentPinnedId!==undefined&&currentPinnedId!==null&&!current)throw Error('current_pin_missing_from_archive');
 const old=current&&current.date<cutoff?current:null;
 const selected=messages.filter(m=>m.date>=cutoff&&m.date<=endDate).sort(byDate);
 const operations=[];
 for(const m of [...(old?[old]:[]),...selected]){
  const user=users.get(String(m.sender_id?.user_id||m.sender_id?.chat_id||''))||{};
  const marker='#src_'+String(group.chat_id).replace(/\D/g,'')+'_'+m.id;
  const pinned=!!m.pinned;
  const texts=renderParts(m,user).map(text=>{const [tags,date,...body]=text.split('\n');return date+'\n'+tags+' '+marker+(pinned?' #закреп':'')+'\n'+body.join('\n')});
  const start=operations.length;
  texts.forEach((text,i)=>operations.push({key:'message:'+m.id+':text:'+i,sourceId:String(m.id),kind:'text',text,hash:hash(text)}));
  for(const [i,f] of (m.files||[]).filter(f=>f.policy?.keep&&!m.hh).entries()){
   const file=media(f),name=file.name;
   const text=texts[0].split('\n').slice(0,2).join('\n')+'\n\nФайл: '+name;
   operations.push({key:'message:'+m.id+':file:'+i,sourceId:String(m.id),kind:'document',text,hash:hash(text),file});
  }
  if(pinned&&operations.length>start)operations.at(-1).pin=true;
 }
 operations.push({key:'notice:v1',kind:'text',text:notice,hash:hash(notice)});
 const result={version:2,clientId:String(group.id),sourceChatId:String(group.chat_id),title:(group.chat?.title||'VEU '+group.client_name+' '+group.stack).replace(/\s*\[\s*ментор[^\]]*\]/giu,'').trim(),cutoff,sourceMessages:selected.length,oldPinFirst:!!old,pins:operations.filter(o=>o.pin).length,operations};
 return {...result,planHash:hash(JSON.stringify(result))};
}
module.exports={hash,NOTICE,buildPlan};
