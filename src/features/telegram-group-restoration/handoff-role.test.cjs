const {test}=require('node:test'),assert=require('node:assert/strict'),{ensureRole}=require('./handoff-role.cjs');
test('role changes are verified; accepted but lost response does not repeat',async()=>{
 let member={className:'ChannelParticipantAdmin'},calls=0,receipt={};const a={inspect:async()=>member,matches:p=>p.className==='ChannelParticipant',save:async r=>{receipt=r;},sleep:async()=>{},change:async()=>{calls++;member={className:'ChannelParticipant'};throw Error('network_lost');}};
 assert.equal((await ensureRole({},a)).done,true);await ensureRole(receipt,a);assert.equal(calls,1);
});
test('unresolved role intent and current owner cannot trigger another write',async()=>{
 const a={inspect:async()=>({className:'ChannelParticipantAdmin'}),matches:()=>false,change:()=>{throw Error('must_not_write');},save:async()=>{}};
 await assert.rejects(ensureRole({intent:true},a),/outcome_unresolved/);a.inspect=async()=>({className:'ChannelParticipantCreator'});await assert.rejects(ensureRole({},a),/current_owner/);
});
