const {test}=require('node:test'),assert=require('node:assert/strict'),{bindSecured}=require('./bind.cjs');
test('atomic two-field update is idempotent; CAS refuses unrelated concurrent writes',async()=>{
 const plan={clientId:'5',sourceChatId:'-111'},state={previous:{telegram_personal_chat_id:'@test',secured_general_chat_id:null,secured_general_chat_invitation_link:null},chatId:'-100123',invitation:'https://t.me/+fake'};
 let row={id:'5',telegram_general_chat_id:'-111',...state.previous},updates=0;const calls=[];
 const db={query:async(sql,args)=>{calls.push(sql);if(sql.startsWith('SELECT id FROM'))return{rows:[]};if(sql.startsWith('SELECT id,'))return{rows:[{...row}]};if(sql.startsWith('UPDATE')){updates++;row={...row,secured_general_chat_id:args[0],secured_general_chat_invitation_link:args[1]};return{rowCount:1};}return{rows:[]};}};
 await bindSecured(db,plan,state);await bindSecured(db,plan,state);assert.equal(updates,1);assert.ok(calls.includes('COMMIT'));assert.equal(row.telegram_general_chat_id,'-111');row.secured_general_chat_invitation_link='changed';await assert.rejects(bindSecured(db,plan,state),/changed/);assert.equal(calls.at(-1),'ROLLBACK');
});
