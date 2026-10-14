import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCloudApi} from './cloud-api.mts';
import {readOctoConfig} from './config.mts';
test('presence check is one cloud GET; deletion tolerates only explicit not_found', async () => {
  let status = 404, code = 'not_found'; const calls: Array<{ url: string; method?: string }> = [];
  const api = createCloudApi('secret', async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    return Response.json({ success: false, code }, { status });
  });
  assert.equal(await api.profileExists('a/b'), false);
  assert.ok(calls[0].url.endsWith('/profiles/a%2Fb')); assert.equal(calls.length, 1);
  await api.deleteProxy('proxy'); assert.equal(calls.at(-1)?.method, 'DELETE');
  for (const pair of [[404, 'permission_denied'], [403, 'not_found'], [500, 'not_found']] as const) {
    [status, code] = pair;
    await assert.rejects(api.profileExists('uuid')); await assert.rejects(api.deleteProxy('proxy'));
  }
});
test('cloud adapter never sends local requests and preserves numeric password strings',async()=>{
  const calls:Array<{url:string;body:any;method?:string}>=[];
  const api=createCloudApi('owner-secret',async(url,options)=>{
    assert.match(String(url),/^https:\/\/app\.octobrowser\.net\/api\/v2\/automation\//);
    calls.push({url:String(url),body:options?.body?JSON.parse(String(options.body)):undefined,method:options?.method});
    return Response.json({success:true,data:{uuid:'a'.repeat(32)}});
  });
  await api.createProfile({title:'test',description:'marker',folder:'home',start_pages:[],tags:[],password:'03742'});
  await api.setPassword('uuid','03742'); await api.clearPassword('uuid','03742');
  assert.equal(calls.length,3); assert.ok(calls.every(c=>c.body.password==='03742'));
  assert.ok(!('startProfile' in api)); assert.ok(!('activeProfiles' in api));
});
test('Guest validation rejects broadened rights, extra folders, tags and unknown true flags',async()=>{
  const folder='a'.repeat(32),permissions={visible_folders:[folder],visible_tags:[],create_profiles:false};
  let guest:any={email:'guest@example.com',master:false,permissions};
  const api=createCloudApi('secret',async()=>Response.json({success:true,data:[guest]}));
  await api.validateGuest('guest@example.com',folder);
  for(const change of [{create_profiles:true},{visible_folders:[folder,'b'.repeat(32)]},{visible_tags:['personal']},{new_right:{enabled:true}}]){
    guest={email:'guest@example.com',master:false,permissions:{...permissions,...change}};
    await assert.rejects(api.validateGuest('guest@example.com',folder),{code:'octo_guest_permissions_changed'});
  }
});
test('production TTL is fixed and disabling grants retains cleanup configuration',()=>{
  assert.equal(readOctoConfig({}),undefined);
  const env={OCTO_ENABLED:'1',OCTO_API_TOKEN:'token',OCTO_ALLOWED_CLIENT_IDS:'901,902',OCTO_GUEST_PASSWORD:'guest',
    OCTO_HOME_FOLDER_UUID:'a'.repeat(32),OCTO_GUEST_FOLDER_UUID:'b'.repeat(32),OCTO_LEASE_MS:'45000'};
  assert.equal(readOctoConfig(env)!.leaseMs,120_000);
  assert.equal(readOctoConfig({...env,OCTO_ENABLED:'0',OCTO_GUEST_PASSWORD:''})!.enabled,false);
  assert.throws(()=>readOctoConfig({...env,OCTO_ALLOWED_CLIENT_IDS:'901,901'}),{code:'octo_configuration_required'});
  assert.deepEqual([...readOctoConfig({...env,OCTO_ALLOWED_CLIENT_IDS:'1,901,902'})!.allowedClientIds],[1,901,902]);
  for(const value of ['', '1,', '0,901', '-1', 'bad'])
    assert.throws(()=>readOctoConfig({...env,OCTO_ALLOWED_CLIENT_IDS:value}),{code:'octo_configuration_required'});
});

test('live folder names resolve to their current UUID; ambiguous and unknown names fail closed',async()=>{
  const folderId='a'.repeat(32);let folder:any='private-pilot',folders=[{uuid:folderId,name:'private-pilot'}];
  const api=createCloudApi('secret',async url=>Response.json({success:true,data:String(url).endsWith('/folders')?folders:
    {uuid:'b'.repeat(32),title:'Alex',folder,start_pages:[],has_user_password:true,status:0}}));
  assert.deepEqual((await api.getProfile('profile')).folder,{uuid:folderId,name:'private-pilot'});
  folder=folderId;assert.equal(((await api.getProfile('profile')).folder as any).uuid,folderId);
  folder={uuid:folderId,name:'private-pilot'};assert.equal(((await api.getProfile('profile')).folder as any).uuid,folderId);
  folder='unknown';await assert.rejects(api.getProfile('profile'),{code:'invalid_octo_response'});
  folder='private-pilot';folders.push({uuid:'c'.repeat(32),name:'private-pilot'});
  await assert.rejects(api.getProfile('profile'),{code:'invalid_octo_response'});
  folder=null;assert.equal((await api.getProfile('profile')).folder,null);
});
