import { mockSkills, mockResumeLanguage, mockJobSearchStatus } from './publication-fixture.ts'
import fs from 'node:fs'
import path from 'node:path'
import { createProfileFillerService } from '../service.ts'
import { ProfileFillerError } from '../errors.ts'
import { verifiedContract } from './contract.test.ts'
import type { PreparedProfile } from '../types.ts'
import type { ResumeSnapshot } from '../hh-resume-ui.ts'

export function makeServiceFixture(directory: string) {
  fs.mkdirSync(directory, { recursive: true })
  const profile: PreparedProfile = {
    client: { clientId: 7, clientName: 'Private Client', currentStatus: 'on en market', market: 'En',
      stack: 'Java', dolphinProfileId: 123, dolphinProfileName: 'Actual Dolphin EN', cvUrl: 'fake', cvRevision: directory,
      stopListCompanies: [], contacts: { email: 'test@example.invalid', other: [] }, fallbacks: {}, credentials: {} },
    cv: { language: 'en', contacts: { email: 'test@example.invalid', other: [] }, summary: 'Summary',
      skillGroups: [], skills: Array.from({ length: 30 }, (_, i) => `Technology ${i}`),
      experience: [{ company: 'Company', title: 'Engineer', current: true, description: 'Description',
        technologies: [], namedOrganizations: [] }], education: [], languages: [{ name: 'English', level: 'B2' }], namedOrganizations: [] },
    titles: ['Senior Java Developer', 'Senior Backend Developer'], about: 'About', employerCandidates: [], preparedAt: new Date().toISOString()
  }
  const calls: string[] = []
  const resumes: ResumeSnapshot[] = []
  const verified = new Set<string>(), privateIds = new Set<string>()
  let serial = 0
  const controls = { failTitle: '', missingCheck: '', limit: false, sourceFailure: false, statusChanged: false,
    inactive: false, wrongLanguage: false, wrongSearchStatus: false, badSkills: false, malformedPublished: false, failDuplicate: false, corruptBaselineAfterCopy: false }
  const put = (title: string, id = `r${++serial}`, isDraft = true) => {
    const value = { id, title, isDraft, href: `https://hh.ru/resume/${id}` }
    const index = resumes.findIndex(item => item.id === id)
    if (index < 0) resumes.push(value); else resumes[index] = value
    return value
  }
  const publicationState = (resume: ResumeSnapshot) => ({ ...resume,
    isActive: !resume.isDraft && !controls.inactive, searchable: !resume.isDraft && !controls.inactive,
    publicationStatus: resume.isDraft ? 'not_finished' : 'new', resumeLanguage: controls.wrongLanguage ? 'RU' : 'EN' })
  const service = createProfileFillerService({
    publication: {
      async read(_page, resume) {
        const row = resumes.find(item => item.id === resume.id)
        if (!row) throw new Error('known resume missing')
        return publicationState(row)
      },
      async activate(_page, resume) {
        calls.push(`activate:${resume.id}`)
        return publicationState(put(resume.title, resume.id, false))
      },
      async verify(_page, resume) { calls.push(`active:${resume.id}`); return publicationState(resume) }
    },
    skills: { ...mockSkills(), async verify(_page, _resume, expected) {
      return expected.slice(controls.badSkills ? 1 : 0).map(name => ({ name, level: 'advanced' }))
    } },
    resumeLanguage: mockResumeLanguage(),
    jobSearchStatus: { ...mockJobSearchStatus(), async verify() {
      if (controls.wrongSearchStatus) throw new Error('job-search status is not active_search')
      return 'active_search' as const
    } },
    repository: {
      async resolveClient() { return { ...profile.client } },
      async revalidateClientStatus() { calls.push('status'); if (controls.statusChanged) throw new ProfileFillerError(
        'profile_status_changed', 'Status changed', 'source_preflight') }
    } as any,
    async loadDolphinProfile(id) { calls.push('dolphin-name'); return { id, name: 'Actual Dolphin EN' } },
    drive: { async loadExperienceDescriptions() { return [] }, async loadCv() {
      if (controls.sourceFailure) throw new Error('CV load failed')
      return { bytes: Buffer.from('fake'), fileName: 'fake.pdf', mimeType: 'application/pdf', revision: '1', source: 'cv' }
    } } as any,
    extractor: { async extract() { return profile.cv } },
    withPage: async (_client, action) => { calls.push('browser'); return action({ screenshot: async () => Buffer.alloc(0) } as any, directory) },
    ui: {
      async listResumes() { return structuredClone(resumes) },
      async inspectHH() { calls.push('dry-run'); return { resumes: structuredClone(resumes), artifact: path.join(directory, 'dry.json') } },
      async createResumeDraft(_page, _profile, title, _dir, id) {
        calls.push(`create:${title}`)
        if (controls.limit) throw new ProfileFillerError('profile_hh_resume_limit', 'HH limit', 'create_resume')
        return put(title, id, !controls.malformedPublished)
      },
      async completeExistingResume(_page, _profile, title, resume) { calls.push(`complete:${resume.id}`); return put(title, resume.id, resume.isDraft) },
      async duplicateResumeVariant(_page, baseline, title, _stack, _market, recovery) {
        calls.push(`${recovery?.duplicateId ? 'reuse-copy' : 'duplicate'}:${title}`)
        if (!verified.has(baseline.id)) throw new Error('unverified_baseline')
        if (controls.failDuplicate) throw new Error('duplicate unavailable')
        return put(title, recovery?.duplicateId, false)
      },
      async ensureResumeEnglish(_page, resume) { calls.push(`english:${resume.id}`); return resume },
      async configurePrivacyAndStopList(_page, resume) {
        calls.push(`privacy:${resume.id}`); privateIds.add(resume.id)
        return verifiedContract(resume.id, resume.title).privacy
      },
      async verifyResumeContract(_page, _profile, resume, title) {
        calls.push(`verify:${resume.id}`)
        const result = { ...verifiedContract(resume.id, title), isDraft: resume.isDraft }
        if (resume.title !== title) result.checks!.title = { status: 'failed' }
        if (title === controls.failTitle) result.checks!.about = { status: 'failed' }
        if (controls.corruptBaselineAfterCopy && resume.id === 'r1' && resumes.some(item => item.id === 'r2')) {
          result.checks!.about = { status: 'failed' }
        }
        if (controls.missingCheck) delete result.checks![controls.missingCheck]
        if (Object.values(result.checks!).every(check => check.status === 'passed')) verified.add(resume.id)
        return result
      },
      async deleteResume(_page, resume) {
        calls.push(`delete:${resume.id}`)
        resumes.splice(resumes.findIndex(item => item.id === resume.id), 1)
      },
      async verifyKnownDraft(_page, title, id) {
        calls.push(`known:${id}`)
        const row = resumes.find(item => item.id === id && item.title === title && item.isDraft)
        if (!row) throw new Error('known draft missing')
        return row
      },
      async resumeDraftFromWorkPermits(_page, _profile, title, id) { calls.push(`permits:${id}`); return put(title, id) },
      async resumeDraftFromExperience(_page, _profile, title, id) { calls.push(`experience:${id}`); return put(title, id) },
      async resumeSkills(_page, _profile, title, id) { calls.push(`skills:${id}`); return put(title, id) }
    }
  })
  return { service, profile, calls, resumes, controls, put }
}
