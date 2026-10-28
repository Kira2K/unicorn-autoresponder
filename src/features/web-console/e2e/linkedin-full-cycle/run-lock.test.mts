import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { lockCycleRun } from './run-lock.mts';
test('only one run owns external attempts; an unreleased claim never silently expires', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'linkedin-run-lock-'));
  try {
    const release = await lockCycleRun(dir);
    await assert.rejects(lockCycleRun(dir), /e2e_run_already_locked/);
    await release(); const next = await lockCycleRun(dir); await next();
  } finally {
    assert.equal(dirname(dir), tmpdir()); assert.ok(basename(dir).startsWith('linkedin-run-lock-'));
    await rm(dir, { recursive: true, force: true });
  }
});
