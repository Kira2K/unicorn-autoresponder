import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudApi } from '../../octo-access/cloud-api.mts';
test('capture reads the actual cloud profile saved proxy rather than stale SQL credentials',async()=>{
  const calls:string[]=[];
  const api=createCloudApi('mock-token',async url=>{
    const path=String(url).replace('https://app.octobrowser.net/api/v2/automation','');calls.push(path);
    return Response.json({success:true,data:path==='/profiles/en-uuid'?{proxy:{uuid:'new-proxy'}}:
      [{uuid:'old-proxy',title:'old',profiles_count:0,type:'http',host:'old.example.org',port:80},
        {uuid:'new-proxy',title:'new',profiles_count:1,type:'socks5',host:'new.example.org',port:1080,login:'login',password:'private'}]});
  });
  const actual=await api.readProfileProxy!('en-uuid');assert.equal(actual.saved?.uuid,'new-proxy');assert.equal(actual.saved?.host,'new.example.org');
  assert.equal(actual.saved?.password,'private');assert.deepEqual(calls,['/profiles/en-uuid','/proxies']);
});
test('inline proxy is returned for the durable attachment workflow; missing/ambiguous proxies never count as saved',async()=>{
  let proxy:unknown={type:'http',host:'inline.example.org',port:8080,login:'l',password:'p'};
  const api=createCloudApi('mock-token',async url=>Response.json({success:true,data:String(url).endsWith('/proxies')?[]:{proxy}}));
  assert.equal((await api.readProfileProxy!('en')).inline?.host,'inline.example.org');
  proxy=null;await assert.rejects(api.readProfileProxy!('en'),{code:'octo_proxy_required'});
  proxy={uuid:'not-listed'};await assert.rejects(api.readProfileProxy!('en'),{code:'octo_proxy_unavailable'});
});
