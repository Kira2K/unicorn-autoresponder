function classifySource(observations){
 if(observations.some(o=>o.writeError==='CHAT_RESTRICTED'))return 'broken';
 if(observations.some(o=>o.restrictions?.some(r=>r.reason==='terms'&&r.platform==='all')))return 'broken';
 // Readability and owner rights do not establish that a student can send.
 if(observations.some(o=>o.historyReadable&&o.fullReadable&&o.canCommunicate&&!o.left&&o.memberPermissionsVerified&&o.writeVerified))return 'healthy';
 if(observations.length&&observations.every(o=>o.error?.startsWith('FLOOD')))return 'waiting';
 return 'needs_review';
}
module.exports={classifySource};
