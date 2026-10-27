import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConsoleFixture} from './console-fixture.mts';
test('real Console auth gates every Octo route, keeps third users and other owners out',async()=>{
  const f=await createConsoleFixture();
  try {
    const call=async(path:string,method='GET',cookie='',body?:unknown)=>fetch(f.url+path,{method,headers:{Cookie:cookie,
      ...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    assert.equal((await call('/api/octo/profiles/status')).status,401);
    assert.equal((await call('/api/octo/profiles/status?proxyCredentials=1')).status,401);
    const login=async(email:string,password='1234')=>call('/api/auth/login','POST','',{email,password});
    assert.equal((await login('alex.octo@example.com','wrong')).status,401);
    const a=(await login('alex.octo@example.com')).headers.get('set-cookie')!.split(';')[0];
    const b=(await login('bob.octo@example.com')).headers.get('set-cookie')!.split(';')[0];
    const other=(await login('alexeevalydia@gmail.com')).headers.get('set-cookie')!.split(';')[0];
    for(const [path,method,body] of [['/api/octo/profiles/status','GET',undefined],['/api/octo/profiles/status?proxyCredentials=1','GET',undefined],['/api/octo/profiles/ensure','POST',{}],
      ['/api/octo/grants','POST',{profileId:1}],['/api/octo/grants/anything','GET',undefined],
      ['/api/octo/profiles/1/proxy','POST',{}], ['/api/octo/onboarding','POST',{source:'none'}],
      ['/api/octo/onboarding/anything/continue','POST',{acceptLowScore:true}],
      ['/api/octo/nodemaven-key','PUT',{key:'fixture-key'}], ['/api/octo/locations?level=countries','GET',undefined]] as const)
      assert.equal((await call(path,method,other,body)).status,403);
    assert.equal((await call('/api/octo/profiles/ensure','POST',a,{})).status,202);
    assert.equal((await call('/api/octo/profiles/ensure','POST',b,{})).status,202);
    const status=await (await call('/api/octo/profiles/status','GET',a)).json();
    assert.equal(status.profiles.length,1);assert.equal('password' in status.profiles[0],false);
    assert.equal((await call('/api/octo/grants','POST',b,{profileId:status.profiles[0].id})).status,404);
    const proxy={type:'socks5',host:'proxy.example.test',port:1234,login:'fixture',password:'secret-fixture'};
    assert.equal((await call(`/api/octo/profiles/${status.profiles[0].id}/proxy`,'POST',b,proxy)).status,404);
    const invalid=await call(`/api/octo/profiles/${status.profiles[0].id}/proxy`,'POST',a,{...proxy,port:0});
    assert.equal(invalid.status,400);assert.equal(invalid.headers.get('cache-control'),'no-store');
    assert.equal((await call('/api/octo/grants/foreign','GET',a)).status,404);
    assert.equal((await call('/api/dolphin/profiles/status','GET',other)).status,200);
  }finally{await f.close();}
});
