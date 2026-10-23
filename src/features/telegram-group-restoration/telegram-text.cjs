// Telegram strips terminal ASCII whitespace. Frozen source text/hash stays intact.
const canonicalText=text=>String(text||'').replace(/[ \t\r\n]+$/u,'');
const sameTelegramText=(expected,actual)=>expected===actual||canonicalText(expected)===actual;
module.exports={canonicalText,sameTelegramText};
