import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLinkedInMockFixture} from '../local-console/mock-fixture.mts';
test('standard student HTTP endpoint rejects bad proxy/country and accepts repeated checked replacements',async()=>{
 const f=await createLinkedInMockFixture(),p=(await f.profiles.list(901))[0];
 await f.profiles.save({...p,proxy:{...p.proxy!,isMadeByExpert:false}});
 f.moves.set(901,{id:'completed-move',clientId:901,accountId:901,profileId:p.id,profileUuid:p.uuid!,country:'ES',fingerprint:'first',phase:'completed',createdAt:'2026-11-01T00:00:00Z',completedAt:'2026-11-02T00:00:00Z',pauseUntil:'2026-11-04T00:00:00Z'});
 const server=f.app.listen(0,'127.0.0.1');await new Promise<void>(done=>server.once('listening',done));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 try{
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'linkedin-local-901@example.invalid',password:'1234'})});assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const save=(host:string)=>fetch(base+`/api/octo/profiles/${p.id}/proxy`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({type:'socks5',host,port:1080,login:'private',password:'private'})});
  const invalid=await fetch(base+'/api/octo/profiles/not-a-number/proxy',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({})});assert.equal(invalid.status,400);assert.equal((await invalid.json()).error,'invalid_profile_id');
  const alternate=await fetch(base+'/api/octo/onboarding',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({source:'manual',proxy:{type:'socks5',host:'wrong.example.invalid',port:1080}})});assert.equal(alternate.status,409);assert.equal((await alternate.json()).error,'linkedin_proxy_move_use_replacement');
  const continueOld=await fetch(base+'/api/octo/onboarding/old-setup/continue',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({acceptLowScore:true})});assert.equal(continueOld.status,409);assert.equal((await continueOld.json()).error,'linkedin_proxy_move_use_replacement');
  for(const host of ['wrong','unknown','dead','timeout']){const response=await save(host+'.example.invalid');assert.equal(response.status,409);const data=await response.json();assert.ok(!JSON.stringify(data).includes('private'));if(host==='wrong')assert.deepEqual(data.proxyCheck,{expectedCountry:'ES',actualCountry:'GE',exitIp:'1.1.1.1'});assert.equal((await f.profiles.get(p.id))?.proxy?.uuid,p.proxy?.uuid);}
  for(const host of ['replacement-one.example.invalid','replacement-two.example.invalid']){
   assert.equal((await save(host)).status,202);
   const end=Date.now()+10000;while((await f.profiles.get(p.id))?.proxy?.host!==host){if(Date.now()>end)throw Error('mock replacement timeout');await new Promise(r=>setTimeout(r,20));}
  }
  assert.equal(f.moves.get(901)?.id,'completed-move');assert.equal(f.moves.get(901)?.completedAt,'2026-11-02T00:00:00Z');assert.equal(f.notices.length,0);
 }finally{await f.close();await new Promise<void>(done=>server.close(()=>done()));}
});
