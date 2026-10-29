/** Authenticate through normal Console auth and verify routing before any E2E mutation. */
export async function verifyNotificationRecipient(input:{url:string;email:string;password:string;expectedMention:string;fetch?:typeof fetch}){
 const request=input.fetch??fetch;
 const response=await request(input.url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({email:input.email,password:input.password}),signal:AbortSignal.timeout(15000)});
 const cookie=response.headers.get('set-cookie')?.split(';')[0];
 if(!response.ok||!cookie)throw Error('e2e_admin_login_unavailable');
 const config=await request(input.url+'/api/admin/linkedin-creation/config',{headers:{cookie},signal:AbortSignal.timeout(15000)});
 const body=await config.json().catch(()=>({}));
 if(!config.ok||body.notificationMention!==input.expectedMention)throw Error('e2e_notification_recipient_not_verified');
 return{mention:body.notificationMention};
}
