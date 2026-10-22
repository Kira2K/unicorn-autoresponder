import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openJournal} from './journal.mjs';
const config={backendUrl:'https://console.example.com',bridgeId:'owner',ownerEmail:'owner@example.com'};
test('portable durable journal retains uncertain writes and device identity; duplicate process and copied state fail closed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'octo-bridge-journal-')),path=join(root,'journal.json');let store;
 try{
  store=await openJournal(path,config,'machine-a');const device=store.data.deviceId;
  store.data.entries.g1={uuid:'a'.repeat(32),digest:'b'.repeat(64),stage:'executing'};await store.save();
  await assert.rejects(openJournal(path,config,'machine-a'),{code:'EEXIST'});
  await store.close();store=undefined;
  await assert.rejects(openJournal(path,config,'machine-b'),{code:'bridge_journal_identity_mismatch'});
  store=await openJournal(path,config,'machine-a');assert.equal(store.data.deviceId,device);assert.equal(store.data.entries.g1.stage,'executing');
  await store.close();store=undefined;
  const before=await readFile(path,'utf8');await assert.rejects(openJournal(path,{...config,backendUrl:'https://other.example.com'},'machine-a'));
  assert.equal(await readFile(path,'utf8'),before);
  await writeFile(path,'broken');await assert.rejects(openJournal(path,config,'machine-a'));assert.equal(await readFile(path,'utf8'),'broken');
 }finally{await store?.close();await rm(root,{recursive:true,force:true});}
});
