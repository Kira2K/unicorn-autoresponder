import test from 'node:test';
import assert from 'node:assert/strict';
import {createBridgeLocalFetch} from './local-api.mjs';
test('local port adapter preserves protected backend traffic and allows only existing localhost operations',async()=>{
 const calls=[];const f=createBridgeLocalFetch(58889,async(...args)=>{calls.push(args);return new Response('{}');});
 const body={method:'DELETE',body:'private',headers:{'content-type':'application/json'}};
 await f('http://127.0.0.1:58888/api/profiles/password',body);
 await f('https://worker.example.test/internal/octo-bridge/v1/poll',{method:'POST'});
 assert.equal(calls[0][0],'http://127.0.0.1:58889/api/profiles/password');assert.equal(calls[0][1],body);
 assert.equal(calls[1][0],'https://worker.example.test/internal/octo-bridge/v1/poll');
 await assert.rejects(f('http://127.0.0.1:58888/api/auth/logout'),{code:'bridge_invalid_local_endpoint'});
 for(const port of [0,80,65536,NaN,1.5])assert.throws(()=>createBridgeLocalFetch(port),{code:'bridge_invalid_local_port'});
});
