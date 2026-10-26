import {test} from 'node:test';
import assert from 'node:assert/strict';
import {harness} from './test-harness.mts';

for(const command of ['menu','start','what_my_stage','ready_pitch']){
  for(const suffix of ['','@mentor_test_bot']){
    test(`/${command}${suffix} opens a fresh visible screen, while its buttons edit that screen`,async()=>{
      const h=harness();await h.command('/menu');const old=h.session();
      assert.equal((await h.command('/'+command+suffix)).code,'ok');
      const current=h.session();assert.notEqual(current.messageId,old.messageId);
      assert.equal(h.sent.at(-1)!.editMessageId,undefined);
      assert.deepEqual(h.store.snapshot().history,{});
      assert.equal((await h.service.handle({updateId:100,username:'alice',userId:1,chatId:'-100',
        messageId:current.messageId,callback:'mentor:home'})).code,'ok');
      await h.flush();assert.equal(h.session().messageId,current.messageId);
      assert.equal(h.sent.at(-1)!.editMessageId,current.messageId);
      assert.equal(h.sent.filter(m=>m.chatId==='-100'&&m.editMessageId===undefined).length,2);
    });
  }
}

test('commands for another bot and unknown commands cannot replace a draft or send a reply',async()=>{
  const h=harness();await h.command('/ready_pitch');const before=h.session(),count=h.sent.length;
  for(const command of ['/menu@another_bot','/what_my_stage@another_bot','/not_a_command'])
    assert.equal((await h.command(command)).code,'invalid');
  assert.deepEqual(h.session(),before);assert.equal(h.sent.length,count);
});
