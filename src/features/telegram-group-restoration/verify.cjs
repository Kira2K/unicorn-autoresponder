const {hash}=require('./plan.cjs');
const {canonicalText,sameTelegramText}=require('./telegram-text.cjs');
function restoredCopies(plan,messages,allowed=['8897025258','8805256389','7586552066']){
 const expected=new Set(plan.operations.map(o=>o.text===undefined?o.hash:hash(canonicalText(o.text))));
 const bot=messages.filter(m=>m.className==='Message'&&allowed.includes(String(m.senderId))).sort((a,b)=>a.id-b.id);
 const copies=bot.filter(m=>expected.has(hash(canonicalText(m.message||''))));
 const marker='#src_'+plan.sourceChatId.replace(/\D/g,'')+'_';
 if(bot.some(m=>!expected.has(hash(canonicalText(m.message||'')))&&(m.message||'').includes(marker)))throw Error('unexpected_restoration_content');
 if(copies.length!==plan.operations.length)throw Error('history_count_mismatch');
 for(let i=0;i<copies.length;i++){const m=copies[i],op=plan.operations[i];if(op.text!==undefined?!sameTelegramText(op.text,m.message||''):hash(m.message||'')!==op.hash)throw Error('history_order_mismatch');if(op.file&&Number(m.media?.document?.size)!==op.file.bytes)throw Error('file_size_mismatch');}
 return copies;
}
module.exports={restoredCopies};
