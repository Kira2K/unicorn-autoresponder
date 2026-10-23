function normalizeChatId(value){
 let s=String(value??'').trim();
 if(!/^[+-]?\d+$/.test(s)){if(!/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(s))throw Error('invalid_chat_id');const n=Number(s);if(!Number.isSafeInteger(n))throw Error('invalid_chat_id');s=String(n);}
 const n=BigInt(s);if(n===0n)throw Error('invalid_chat_id');return String(n>0n?-n:n);
}
module.exports={normalizeChatId};
