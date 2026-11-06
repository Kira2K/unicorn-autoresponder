import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unusedTestProxy} from './test-proxy.mts';
test('a free test UUID cannot borrow the connection of an active clone or an unmarked proxy',()=>{
  const row={uuid:'source',title:'test fixture',profiles_count:0,type:'socks5',host:'example.invalid',port:1080,login:'fixture',password:'synthetic'};
  assert.equal(unusedTestProxy([row],'source').host,'example.invalid');
  assert.throws(()=>unusedTestProxy([row,{...row,uuid:'clone',profiles_count:1}],'source'),/connection_in_use/);
  assert.throws(()=>unusedTestProxy([{...row,title:'Student real proxy'}],'source'),/unused_test_proxy_required/);
  assert.throws(()=>unusedTestProxy([row],'source',new Set(['source'])),/unused_test_proxy_required/);
});
