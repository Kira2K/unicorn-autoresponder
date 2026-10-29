import {test} from 'node:test';import assert from 'node:assert/strict';
import {verifyNotificationRecipient} from './notification-recipient.mts';
test('E2E recipient guard accepts only the deployed override; old/missing routing blocks without any send',async()=>{
 for(const mention of ['@KiraSamsonova','@juliafeels',undefined]){
  const calls:Array<{url:string;method:string}>=[];
  const result=verifyNotificationRecipient({url:'https://console.invalid',email:'fixture',password:'fixture-secret',expectedMention:'@KiraSamsonova',
   fetch:async(url,options)=>{
    calls.push({url:String(url),method:options?.method??'GET'});
    if(String(url).endsWith('/login'))return new Response('{}',{headers:{'set-cookie':'session=fixture; HttpOnly'}});
    assert.equal(new Headers(options?.headers).get('cookie'),'session=fixture');
    return new Response(JSON.stringify({notificationMention:mention}));
   }});
  if(mention==='@KiraSamsonova')assert.deepEqual(await result,{mention});
  else await assert.rejects(result,{message:'e2e_notification_recipient_not_verified'});
  assert.deepEqual(calls.map(c=>[new URL(c.url).pathname,c.method]),[['/api/auth/login','POST'],['/api/admin/linkedin-creation/config','GET']]);
 }
});
test('missing admin session blocks before fetching notification configuration',async()=>{
 let calls=0;
 await assert.rejects(verifyNotificationRecipient({url:'https://console.invalid',email:'fixture',password:'fixture',expectedMention:'@KiraSamsonova',
  fetch:async()=>{calls++;return new Response('{}',{status:401});}}),{message:'e2e_admin_login_unavailable'});
 assert.equal(calls,1);
});
