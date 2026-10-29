import {test} from 'node:test';import assert from 'node:assert/strict';import {proxyFieldErrors} from './proxy-field-errors.js';
test('proxy validation identifies individual fields without changing the draft',()=>{
 const draft={type:'socks5',host:'https://wrong:1080',port:'0',password:'private',changeIpUrl:'wrong'},before={...draft};
 assert.deepEqual(Object.keys(proxyFieldErrors(draft)),['host','port','changeIpUrl']);assert.deepEqual(draft,before);
 assert.deepEqual(proxyFieldErrors({type:'socks5',host:'gate.example.com',port:1080}),{});
});
