const {test}=require('node:test'),assert=require('node:assert/strict');
const {classifySource}=require('./source-health.cjs');
test('verified working source is preserved despite missing access on another account',()=>assert.equal(classifySource([{error:'CHANNEL_PRIVATE'},{historyReadable:true,fullReadable:true,canCommunicate:true,left:false,memberPermissionsVerified:true,writeVerified:true}]),'healthy'));
test('readable history and owner permissions alone never establish a working source',()=>assert.equal(classifySource([{historyReadable:true,fullReadable:true,canCommunicate:true,left:false}]),'needs_review'));
test('actual CHAT_RESTRICTED overrides readable history and permissive flags',()=>assert.equal(classifySource([{historyReadable:true,fullReadable:true,canCommunicate:true,writeError:'CHAT_RESTRICTED'}]),'broken'));
test('missing access and flood never establish a broken source',()=>{assert.equal(classifySource([{error:'CHANNEL_PRIVATE'},{error:'FLOOD'}]),'needs_review');assert.equal(classifySource([{error:'FLOOD_WAIT_60'}]),'waiting');});
test('explicit all-platform terms restriction establishes broken source',()=>assert.equal(classifySource([{restrictions:[{reason:'terms',platform:'all'}]}]),'broken'));
test('read-only, left or unverified sources are not classified as healthy',()=>{assert.equal(classifySource([{historyReadable:true,fullReadable:true,canCommunicate:false}]),'needs_review');assert.equal(classifySource([{historyReadable:true,fullReadable:true,canCommunicate:true,left:true}]),'needs_review');});
