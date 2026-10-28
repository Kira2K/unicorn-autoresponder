import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

/** A crashed run leaves evidence for review; another process must not repeat its external calls. */
export async function lockCycleRun(directory: string) {
  const file = resolve(directory, 'run.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw Error('e2e_run_already_locked'); throw error; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); await handle.sync(); }
  finally { await handle.close(); }
  return async () => { await unlink(file); };
}
