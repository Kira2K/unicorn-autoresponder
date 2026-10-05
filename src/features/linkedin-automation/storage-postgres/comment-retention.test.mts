import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {featureFixture} from './fixture.mts';import {createSqlCommentStore} from './comment-store.mts';
const {createCommentMonitorStore}=createRequire(import.meta.url)('../comment-monitor/noco-store.ts');
import { mkdtemp, writeFile, utimes, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { purgeDetailedLogs } from '../log-retention.ts';
const cutoff='2026-08-15T12:00:00.000Z';
const samples=[['old','2026-08-15T11:59:59.999Z'],['equal',cutoff],['new','2026-08-15T12:00:00.001Z'],
 ['late','2026-08-15T23:59:59.000Z'],['next','2026-08-16T00:00:00.000Z']];
test('legacy purge does not delete recovery and deduplication data in either store',async()=>{
 const f=featureFixture(),deleted:number[]=[];const raw=samples.map(([job_id,created_at],i)=>({Id:i+1,job_id,created_at,platform_account_id:21}));
 for(const row of raw)f.seed('linkedin_comment_monitor_jobs',row.Id,row);
 const noco=createCommentMonitorStore({config:{baseId:'fake'},
  async request(){return [{id:'monitor',title:'linkedin_comment_monitor_jobs'}];},
  async fetchRecords(){return structuredClone(raw);},async deleteRecord(_table:string,id:number){deleted.push(Number(id));}});
 await noco.purge(cutoff);assert.deepEqual(deleted,[]);
 const sql=createSqlCommentStore(f.db,f.grant);await sql.purge(cutoff);
 assert.deepEqual((await sql.list()).map(x=>x.jobId).sort(),['equal','late','new','next','old']);
 assert.equal(f.calls.filter(x=>x==='delete').length,0);
});
test('SQL purge compares offsets and never deletes an unknown timestamp or an invalid cutoff',async()=>{
 const f=featureFixture(),sql=createSqlCommentStore(f.db,f.grant);
 for(const [i,created_at] of ['2026-08-15T15:00:00+03:00','2026-08-15T11:59:59Z',null,''].entries())
  f.seed('linkedin_comment_monitor_jobs',i+1,{job_id:String(i),created_at,platform_account_id:21});
 await sql.purge('invalid');assert.equal(f.calls.length,0);
 await sql.purge(cutoff);assert.deepEqual((await sql.list()).map(x=>x.jobId).sort(),['0','1','2','3']);
});

test('30-day cleanup removes only old detailed logs, preserving current logs and recovery files', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'linkedin-log-retention-'));
 const now = Date.now(), old = new Date(now - 31 * 86_400_000);
 try {
  for (const name of ['old.jsonl', 'current.jsonl', 'journal.json']) {
   const file = join(directory, name); await writeFile(file, '{}');
   if (name !== 'current.jsonl') await utimes(file, old, old);
  }
  await purgeDetailedLogs(directory, now);
  assert.deepEqual((await readdir(directory)).sort(), ['current.jsonl', 'journal.json']);
 } finally { await rm(directory, { recursive: true, force: true }); }
});
