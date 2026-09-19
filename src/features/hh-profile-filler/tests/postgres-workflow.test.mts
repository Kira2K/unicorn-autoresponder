import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeHhFixture } from './postgres-fixture.mts';
import { createProfileFillerNocoRepository } from '../noco-repository.ts';
import { createProfileFillerRepository } from '../repository.ts';
import { createProfileFillerService } from '../service.ts';
import { emptyState, observeStatusTransitions, readState, writeState, eligibleJobs } from '../state-store.ts';
import type { CvProfile } from '../types.ts';

export async function runPostgresWorkflowTests() {
  const f = makeHhFixture(), old = createProfileFillerNocoRepository(f.records);
  const sql = createProfileFillerRepository('postgres', async () => f.reader);
  for (const [id, market] of [[1, 'En'], [2, 'Ru']] as const) {
    const calls: string[][] = [[], []];
    const prepare = (repository: typeof sql, index: number) => createProfileFillerService({
      repository,
      drive: {
        async loadCv(url) { calls[index].push(url); return { bytes: Buffer.from('fake CV'),
          fileName: 'fake.pdf', mimeType: 'application/pdf', revision: 'unchanged', source: 'cv' }; },
        async loadExperienceDescriptions(url) { calls[index].push(String(url)); return []; }
      },
      extractor: { async extract(documents, language) {
        calls[index].push(documents[0].revision, language);
        return { language: market === 'En' ? 'en' : 'ru', fullName: id === 1 ? 'Fake Author' : 'Second',
          contacts: { email: 'cv@example.invalid', other: [] }, summary: 'Summary', skillGroups: [],
          skills: ['Go'], experience: [{ company: 'Fake Co', title: 'Engineer', current: true,
            description: 'Built tools.', technologies: [], namedOrganizations: [] }],
          education: [], languages: [], namedOrganizations: [] } satisfies CvProfile;
      } },
      withPage: async () => { throw new Error('unexpected_browser'); }
    }).prepare(id, market);
    const expected = await prepare(old, 0), actual = await prepare(sql, 1);
    assert.deepEqual({ ...actual, preparedAt: '' }, { ...expected, preparedAt: '' });
    assert.deepEqual(calls[1], calls[0]);
  }
  const now = '2026-09-10T00:00:00.000Z';
  const state = emptyState(), sqlState = emptyState();
  observeStatusTransitions(state, await old.listClients(), now);
  observeStatusTransitions(sqlState, await sql.listClients(), now);
  assert.deepEqual(sqlState, state);
  state.jobs[0].status = 'failed'; state.jobs[0].attemptCount = 1;
  state.jobs[0].nextAttemptAt = '2026-09-15T00:00:00.000Z'; state.jobs[1].status = 'completed';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-sql-state-'));
  try {
    const file = path.join(directory, 'state.json'); writeState(state, file);
    const resumed = readState(file), fresh = createProfileFillerRepository('postgres', async () => f.reader);
    assert.deepEqual(observeStatusTransitions(resumed, await fresh.listClients(), now), []);
    assert.deepEqual(resumed, state); assert.deepEqual(eligibleJobs(resumed, now), []);
    assert.equal(eligibleJobs(resumed, '2026-09-16T00:00:00Z').length, 1);
    // A genuine status transition still creates exactly the old job, not a date-format-only job.
    f.data.clients[0].client_status = 'on ru market';
    f.data.clients[0].UpdatedAt = '2026-09-11T03:04:05+00:00';
    await old.listClients(true);
    assert.deepEqual(observeStatusTransitions(resumed, await fresh.listClients(true), now),
      observeStatusTransitions(state, await old.listClients(), now));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
