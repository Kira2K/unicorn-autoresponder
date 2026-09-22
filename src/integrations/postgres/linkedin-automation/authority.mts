import type { SqlPool, CopyDatabase, SqlSession } from '../contracts.mts';
import { assertCopyDatabase } from '../read-session.mts';
import { automationError, type ExecutionAuthority } from '../../../features/linkedin-automation/orchestrator/contracts.ts';
// A dedicated session owns the lock; writer IDs cannot create independent locks on the same DB.
export async function acquireLinkedInAuthority(pool: SqlPool, database: CopyDatabase) {
  const session: SqlSession = await pool.connect();
  let owned = false, released = false;
  const lose = () => { owned = false; if (!released) { released = true; session.release(true); } };
  try {
    await assertCopyDatabase(session, database);
    const result = await session.query("SELECT pg_try_advisory_lock(hashtextextended('unicorn:linkedin:writer:v1',0)) AS owned");
    if (result.rows[0]?.owned !== true) throw automationError('automation_writer_active');
    owned = true;
  } catch (error) { lose(); throw error; }
  const authority: ExecutionAuthority = {
    assertOwned() { if (!owned) throw automationError('automation_writer_unavailable'); },
    async check() {
      authority.assertOwned();
      try { await session.query('SELECT 1 AS alive'); }
      catch { lose(); throw automationError('automation_writer_unavailable'); }
    }
  };
  const timer = setInterval(() => { void authority.check().catch(() => {}); }, 5000);
  timer.unref();
  return { ...authority, async close() {
    clearInterval(timer); owned = false;
    if (!released) {
      try { await session.query("SELECT pg_advisory_unlock(hashtextextended('unicorn:linkedin:writer:v1',0))"); }
      finally { lose(); }
    }
  } };
}
