import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NAMES, TestError } from './contract.mts';
import type { State, Store } from './contract.mts';

function validate(value: any): State {
  const validId = (id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  if (!value || value.schema !== 1 || !validId(value.runId)
    || !['new', 'ready', 'working', 'blocked'].includes(value.phase)
    || !value.folders || !value.profiles
    || !(value.active === null || NAMES.includes(value.active))
    || !(value.grantedAt === null || Number.isSafeInteger(value.grantedAt) && value.grantedAt >= 0)
    || ((value.active === null) !== (value.grantedAt === null))) throw new TestError('invalid_state_file', 500);
  for (const name of NAMES) if (value.profiles[name] !== undefined && !validId(value.profiles[name])) throw new TestError('invalid_state_file', 500);
  for (const key of ['home', 'guest']) {
    const folder = value.folders[key];
    if (folder !== undefined && (!validId(folder.uuid) || typeof folder.name !== 'string')) throw new TestError('invalid_state_file', 500);
  }
  if (value.phase === 'ready' && (!value.folders.home || !value.folders.guest || !value.profiles.Alex || !value.profiles.Bob
    || value.profiles.Alex === value.profiles.Bob || value.folders.home.uuid === value.folders.guest.uuid)) throw new TestError('invalid_state_file', 500);
  return value;
}

export function createFileStore(path: string): Store {
  return createValidatedFileStore(path, validate);
}

export function createValidatedFileStore<T>(path: string, validateState: (value: unknown) => T): { load(): Promise<T | null>; save(state: T): Promise<void> } {
  return {
    async load() {
      let text: string;
      try { text = await readFile(path, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      try { return validateState(JSON.parse(text)); } catch { throw new TestError('invalid_state_file', 500); }
    },
    async save(state) {
      validateState(state);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        for (let attempt = 0; ; attempt++) {
          try { await rename(temporary, path); break; }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= 4) throw error;
            await new Promise(done => setTimeout(done, 100 * (attempt + 1)));
          }
        }
      } finally { await unlink(temporary).catch(() => {}); }
    }
  };
}

// Hold one lock for the lifetime of the API process. Never steal another process's lock.
export async function acquireProcessLock(statePath: string) {
  await mkdir(dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`;
  let handle;
  try { handle = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new TestError('test_backend_lock_exists', 409);
    throw error;
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid })); }
  catch (error) { await handle.close(); await unlink(lockPath); throw error; }
  return async () => { await handle.close(); await unlink(lockPath); };
}
