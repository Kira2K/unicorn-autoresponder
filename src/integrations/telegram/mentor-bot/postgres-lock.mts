import type { SqlPool, SqlSession } from '../../postgres/contracts.mts';
import type { RuntimeLock } from './runtime.mts';
import { assertDatabase,mentorSchema } from './postgres-store.mts';
import type { DatabaseGate } from './postgres-store.mts';
export function postgresLock(pool:SqlPool,gate:DatabaseGate):RuntimeLock {
  const schema=mentorSchema(gate);
  let session:SqlSession|undefined;
  return {
    async acquire(){
      if(session)return false;
      const candidate=await pool.connect();
      try{
        await assertDatabase(candidate,gate);
        const row=(await candidate.query(gate.pilot?'SELECT pg_try_advisory_lock(85102,hashtext($1)) AS acquired':
          'SELECT pg_try_advisory_lock(85101,2) AS acquired',gate.pilot?[schema]:[])).rows[0];
        if(row?.acquired!==true){candidate.release();return false;}
        session=candidate;return true;
      }catch(error){candidate.release(true);throw error;}
    },
    async assertHeld(){
      if(!session)throw new Error('mentor_worker_lock_lost');
      await session.query('SELECT 1');
    },
    async release(){
      const current=session;session=undefined;
      if(!current)return;
      try{await current.query(gate.pilot?'SELECT pg_advisory_unlock(85102,hashtext($1))':
        'SELECT pg_advisory_unlock(85101,2)',gate.pilot?[schema]:[]);}finally{current.release(true);}
    }
  };
}
