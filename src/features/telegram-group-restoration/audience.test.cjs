const {test}=require('node:test'),assert=require('node:assert/strict'),{buildAudience}=require('./audience.cjs');
test('students, excluded numeric IDs and bots never enter file; unknown roles block publication',()=>{
 const users=new Map([['1',{first_name:'Student',usernames:{active_usernames:['student']}}],['2',{first_name:'Mentor <',usernames:{active_usernames:['mentor']}}],['3',{first_name:'Unknown'}],['4',{type:{_:'userTypeBot'}}],['1343900712',{first_name:'Renamed Tanya'}],['415009258',{first_name:'Renamed Vlada'}]]);
 const r=buildAudience({members:[...users.keys()].map(user_id=>({user_id,chat_id:'-1'})),users,clients:[{telegram_personal_chat_id:'@STUDENT'}],staffIds:['1','2','1343900712','415009258'],groups:new Map([['-1',{clientId:'1',title:'Test',invitation:'https://t.me/+fake'}]])});
 assert.deepEqual(r.people.map(p=>p.id),['2']);assert.deepEqual(r.unresolved.map(p=>p.id),['3']);assert.match(r.html,/Mentor &lt;/);assert.match(r.html,/Общие группы по стекам пока не созданы/);assert.doesNotMatch(r.html,/Student|Tanya|Vlada|Unknown/);
});
