import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createProfileFillerService } from '../service.ts'
import { ProfileFillerError } from '../errors.ts'
import type { PreparedProfile } from '../types.ts'

export async function runServiceTests() {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-profile-filler-test-'))
  const old = [
    { id: 'old-1', title: 'Old 1', href: 'https://hh.ru/resume/old-1', isDraft: false },
    { id: 'old-2', title: 'Old 2', href: 'https://hh.ru/resume/old-2', isDraft: true }
  ]
  const created: any[] = []
  const deleted: string[] = []
  let listCalls = 0
  let createCalls = 0
  const profile: PreparedProfile = {
    client: { clientId: 7, clientName: 'Client', currentStatus: 'on en market', market: 'En',
      stack: 'Java', dolphinProfileId: 123, cvUrl: 'url', cvRevision: '1',
      contacts: { other: [] }, fallbacks: {}, credentials: {} },
    cv: { language: 'en', contacts: { email: 'cv@example.com', other: [] },
      summary: 'Summary', skillGroups: [], skills: ['Java'], experience: [{ company: 'Old Co',
        title: 'Engineer', current: true, description: 'Work', technologies: [],
        namedOrganizations: [] }], education: [], languages: [], namedOrganizations: [] },
    titles: ['Title A', 'Title B'], about: 'Contacts\ncv@example.com\n\nSummary\nSummary',
    employerCandidates: [], preparedAt: '2026-09-03T00:00:00Z'
  }
  const fakePage = { screenshot: async () => undefined }
  const service = createProfileFillerService({
    repository: {} as any,
    drive: {} as any,
    extractor: {} as any,
    withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
    ui: {
      async listResumes() { listCalls += 1; return listCalls === 1 ? old : created },
      async createResumeDraft(_page: any, _profile: any, title: string) {
        createCalls += 1
        if (createCalls === 1) throw new ProfileFillerError('profile_hh_resume_limit',
          'limit', 'create_resume')
        const resume = { id: `new-${created.length + 1}`, title,
          href: `https://hh.ru/resume/new-${created.length + 1}`, isDraft: true }
        created.push(resume)
        return resume
      },
      async deleteResume(_page: any, resume: any) { deleted.push(resume.id) },
      async configurePrivacyAndStopList() { return { added: [], existing: [], skipped: [] } },
      async inspectHH() { return { resumes: old, artifact: 'artifact' } }
    } as any
  })
  const result = await service.execute(profile, 'job')
  assert.equal(result.ok, true)
  assert.deepEqual(result.createdResumeTitles, ['Title A', 'Title B'])
  assert.deepEqual(deleted, ['old-1', 'old-2'])

  let destructiveCreateCalls = 0
  const criticalService = createProfileFillerService({
    repository: {} as any,
    drive: {} as any,
    extractor: {} as any,
    withPage: async (_client: any, action: any) => await action(fakePage, artifactDir),
    ui: {
      async listResumes() { return old },
      async createResumeDraft() {
        destructiveCreateCalls += 1
        if (destructiveCreateCalls === 1) throw new ProfileFillerError(
          'profile_hh_resume_limit', 'limit', 'create_resume')
        throw new Error('replacement failed')
      },
      async deleteResume() { return undefined },
      async configurePrivacyAndStopList() { return { added: [], existing: [], skipped: [] } },
      async inspectHH() { return { resumes: old, artifact: 'artifact' } }
    } as any
  })
  await assert.rejects(() => criticalService.execute(profile, 'critical-job'),
    (error: any) => error?.code === 'profile_hh_critical_partial_deletion' &&
      Array.isArray(error?.details?.deletedResumeIds))
  fs.rmSync(artifactDir, { recursive: true, force: true })
}
