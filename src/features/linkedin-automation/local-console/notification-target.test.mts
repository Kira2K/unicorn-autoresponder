import {test} from 'node:test';import assert from 'node:assert/strict';
import {routeLocalTestNotice,localTestChat} from './notification-target.mts';
test('only scoped local fixtures use the authorized test group and topic 1',()=>{
  const original={chatId:'-1003187558078',text:'synthetic',parseMode:'HTML' as const,reportContext:{clientId:307}};
  assert.deepEqual(routeLocalTestNotice(original,[306,307]),{...original,chatId:localTestChat});
  assert.equal(routeLocalTestNotice({...original,messageThreadId:99},[307]).messageThreadId,undefined,'General topic 1 omits the thread field, including an old draft topic');
  assert.equal(routeLocalTestNotice(original,[]),original);assert.equal(routeLocalTestNotice(original,[306]),original);
  assert.equal(routeLocalTestNotice({chatId:'-7',text:'synthetic'},[306,307]).chatId,'-7');assert.equal(original.chatId,'-1003187558078');
});
