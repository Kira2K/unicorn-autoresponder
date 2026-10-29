import {test} from 'node:test';import assert from 'node:assert/strict';
import {cycleConsoleUrl} from './context.mts';
test('cycle Console target defaults to production and accepts explicit loopback only',()=>{
 assert.equal(cycleConsoleUrl({}),'https://very-evil-unicorn.onrender.com');
 for(const value of ['http://127.0.0.1:4300','http://localhost:4301/','http://[::1]:4300'])
  assert.equal(cycleConsoleUrl({LINKEDIN_E2E_CONSOLE_URL:value}),value.replace(/\/$/,''));
 for(const value of ['https://example.com','https://127.0.0.1:4300','http://127.0.0.1:4300/path','http://user:pass@localhost:4300','not-a-url'])
  assert.throws(()=>cycleConsoleUrl({LINKEDIN_E2E_CONSOLE_URL:value}),/e2e_console_target_invalid/);
});
