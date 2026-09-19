import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProfileFillerNocoRepository } from '../noco-repository.ts';
import { createProfileFillerRepository } from '../repository.ts';
import { createProfileFillerService } from '../service.ts';
import { professionForTitle, type ResumeSnapshot } from '../hh-resume-ui.ts';
import { titlesForStack } from '../stack-titles.ts';
import { makeHhFixture } from './postgres-fixture.mts';
import type { CvProfile, ProfileFillerMarket } from '../types.ts';

type Mode = 'normal' | 'dry-run' | 'work-permits' | 'privacy' | 'delete-old' | 'verify-final' | 'smoke';
const modes: Mode[] = ['normal', 'dry-run', 'work-permits', 'privacy', 'delete-old', 'verify-final', 'smoke'];

async function runScenario(repository: ReturnType<typeof createProfileFillerRepository>, id: number,
  market: ProfileFillerMarket, mode: Mode, directory: string) {
  const client = await repository.resolveClient(id, market), calls: unknown[] = [];
  const titles = titlesForStack(client.stack, market).map(title => professionForTitle(title, market));
  const draft = (title: string, index: number): ResumeSnapshot => ({ id: `draft-${index}`, title,
    href: `https://hh.ru/resume/draft-${index}`, isDraft: true });
  const recovery = !['normal', 'dry-run', 'smoke'].includes(mode);
  let resumes = recovery ? titles.map(draft) : [];
  const old = { id: 'old', title: 'Old resume', href: 'https://hh.ru/resume/old', isDraft: false };
  if (mode !== 'verify-final') resumes.push(old);
  const putDraft = (title: string, resumeId?: string) => {
    const row = draft(professionForTitle(title, market), resumes.length);
    if (resumeId) row.id = resumeId;
    resumes = [...resumes.filter(item => item.id !== row.id), row];
    return row;
  };
  const cv: CvProfile = { language: market === 'En' ? 'en' : 'ru',
    fullName: id === 1 ? 'Fake Author' : 'Second', contacts: { email: 'cv@example.invalid', other: [] },
    summary: 'Summary', skillGroups: [], skills: ['Go'], experience: [{ company: 'Fake Co',
      title: 'Engineer', current: true, description: 'Built tools.', technologies: ['SQL'], namedOrganizations: [] }],
    education: [], languages: [], namedOrganizations: [] };
  const service = createProfileFillerService({ repository,
    drive: {
      async loadCv(url) { calls.push(['cv', url]); return { bytes: Buffer.from('CV'), fileName: 'fake.pdf',
        mimeType: 'application/pdf', revision: 'cv-revision', source: 'cv' }; },
      async loadExperienceDescriptions(url) { calls.push(['experience', url]); return [{ bytes: Buffer.from('Experience'),
        fileName: 'Описание опыта.pdf', mimeType: 'application/pdf', revision: 'experience-revision', source: 'experience_description' }]; }
    },
    extractor: { async extract(documents, language) {
      calls.push(['extract', documents.map(d => [d.source, d.revision]), language]); return cv;
    } },
    withPage: async (resolved, action) => {
      assert.deepEqual(resolved, client); calls.push(['browser', resolved.clientId, resolved.dolphinProfileId]);
      return action({ screenshot: async () => Buffer.alloc(0) } as any, directory);
    },
    ui: {
      async listResumes() { return structuredClone(resumes); },
      async inspectHH() { calls.push(['inspect']); return { resumes, artifact: directory }; },
      async createResumeDraft(_page, profile, title, _directory, resumeId) {
        calls.push(['create', title, resumeId, profile.cv.skills]); return putDraft(title, resumeId);
      },
      async duplicateResumeVariant() { throw new Error('unexpected_duplicate'); },
      async deleteResume(_page, resume) { calls.push(['delete', resume.id]); resumes = resumes.filter(r => r.id !== resume.id); },
      async configurePrivacyAndStopList(_page, resume) {
        calls.push(['privacy', resume.id]); return { added: [], existing: [], skipped: [] };
      },
      async resumeDraftFromWorkPermits(_page, _profile, title, resumeId) {
        calls.push(['work-permits', resumeId]); return putDraft(title, resumeId);
      },
      async verifyKnownDraft(_page, title, resumeId) {
        calls.push(['verify', resumeId]); const row = resumes.find(r => r.id === resumeId);
        assert.equal(row?.title, title); return row!;
      }
    }
  });
  const result = mode === 'smoke' ? await service.runLiveSmoke(id, market)
    : await service.run(id, market, mode === 'dry-run', undefined, false,
        mode === 'work-permits' ? 'draft-0' : undefined, recovery ? mode as Exclude<Mode, 'normal' | 'dry-run' | 'smoke'> : undefined,
        mode === 'verify-final' ? titles.map((_title, index) => `draft-${index}`) : []);
  assert.equal(result.ok, true, `${market}/${mode}: ${result.message}`);
  assert.deepEqual(calls.slice(0, 3), [['cv', client.cvUrl], ['experience', client.studentFolderUrl],
    ['extract', [['cv', 'cv-revision'], ['experience_description', 'experience-revision']], market]]);
  if (mode === 'normal') assert.ok(calls.some(c => Array.isArray(c) && c[0] === 'create' && c[3].includes('SQL')));
  if (mode === 'dry-run') assert.deepEqual(resumes, [old]);
  if (mode === 'smoke') assert.deepEqual(resumes, [old]);
  return { result: { ...result, artifactDir: undefined }, calls, resumes };
}

export async function runPostgresExecutionTests() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-sql-execution-'));
  const keys = ['PROFILE_FILLER_ARTIFACT_ROOT', 'PROFILE_FILLER_SMOKE_CLIENT_ID', 'PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID'];
  const saved = keys.map(key => process.env[key]);
  process.env.PROFILE_FILLER_ARTIFACT_ROOT = directory;
  let comparisons = 0;
  try {
    for (const [id, market, dolphinId] of [[1, 'En', 201], [2, 'Ru', 301]] as const) {
      process.env.PROFILE_FILLER_SMOKE_CLIENT_ID = String(id);
      process.env.PROFILE_FILLER_SMOKE_DOLPHIN_PROFILE_ID = String(dolphinId);
      for (const mode of modes) {
        const f = makeHhFixture();
        // Independent Noco fixtures: the reference does not reuse SQL relation/filter code.
        const old = createProfileFillerNocoRepository(f.records);
        const sql = createProfileFillerRepository('postgres', async () => f.reader);
        assert.deepEqual(await runScenario(sql, id, market, mode, directory),
          await runScenario(old, id, market, mode, directory), `${market}/${mode}`);
        assert.ok(f.requests.length > 0); comparisons++;
      }
    }
    console.log(`HH SQL execution parity: ${comparisons} scenarios passed (external actions mocked).`);
  } finally {
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
