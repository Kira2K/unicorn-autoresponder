const {audience,target}=require('./policy.cjs');
function ambiguousDestinations(rows){const selected=new Set(audience(rows).filter(r=>r.eligible).map(r=>r.clientId)),counts=new Map();for(const row of rows){if(!selected.has(String(row.id)))continue;const d=target(row);if(d)counts.set(d.chatId,(counts.get(d.chatId)||0)+1);}return new Set([...counts].filter(([,n])=>n>1).map(([id])=>id));}
module.exports={ambiguousDestinations};
