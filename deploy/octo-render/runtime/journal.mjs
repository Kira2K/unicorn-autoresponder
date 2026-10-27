import { readFile, readlink, rename, writeFile } from 'node:fs/promises';
import { openJournal } from '../bridge/journal.mjs';
import { fail } from './settings.mjs';

// A PID can be reused in a replacement container. Check its namespace, boot and
// kernel start time before deciding whether the original owner is still alive.
export async function processStamp(pid) {
  try {
    const [stat, namespace, boot] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'), readlink(`/proc/${pid}/ns/pid`),
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
    ]);
    const start = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
    if (!/^\d+$/.test(start ?? '')) throw fail('bridge_render_process_identity_unknown');
    return `${boot.trim()}:${namespace}:${start}`;
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ESRCH') return null;
    throw fail('bridge_render_process_identity_unknown');
  }
}

// The entrypoint must already hold flock on this disk for the whole service.
export async function openRenderJournal(path, config, machine, {
  stamp = processStamp, pid = process.pid, now = Date.now,
} = {}) {
  const lockPath = `${path}.lock`;
  let previous;
  try { previous = JSON.parse(await readFile(lockPath, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw fail('bridge_render_lock_requires_review'); }
  if (previous) {
    if (previous.machine !== machine || !Number.isInteger(previous.pid) || previous.pid < 1
      || typeof previous.processStamp !== 'string' || !previous.processStamp)
      throw fail('bridge_render_lock_requires_review');
    if (await stamp(previous.pid) === previous.processStamp) throw fail('bridge_render_process_still_alive');
    await rename(lockPath, `${lockPath}.stale-${now()}`);
  }
  const current = await stamp(pid);
  if (!current) throw fail('bridge_render_process_identity_unknown');
  const journal = await openJournal(path, config, machine);
  try {
    await writeFile(lockPath, JSON.stringify({ pid, machine, processStamp: current }), { mode: 0o600 });
    return journal;
  } catch {
    await journal.close();
    throw fail('bridge_render_lock_write_failed');
  }
}
