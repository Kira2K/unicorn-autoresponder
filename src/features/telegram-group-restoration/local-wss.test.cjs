const {test}=require('node:test'),assert=require('node:assert/strict');
const {useLocalWss}=require('./local-wss.cjs');
test('main connection and extra upload/download senders resolve WSS endpoints',async()=>{
 const resolved=[],sessions=[];let connected=false;
 const client={
  session:{dcId:4,setDC:(...args)=>sessions.push(args)},
  getDC:async(id,download=false,web=false)=>{resolved.push({id,download,web});return{ipAddress:web?'web-endpoint':'tcp-endpoint',port:web?443:80};},
  connect:async()=>{connected=true;return 'connected';}
 };
 assert.equal(useLocalWss(client),client);
 assert.equal(await client.connect(),'connected');assert.equal(connected,true);
 assert.equal(client.useWSS,true);assert.deepEqual(sessions,[[4,'web-endpoint',443]]);
 await client.getDC(4,true);await client.getDC(2,false);
 assert.deepEqual(resolved,[{id:4,download:false,web:true},{id:4,download:true,web:true},{id:2,download:false,web:true}]);
});
