import assert from 'node:assert/strict'
import { buildPreparedProfile } from '../profile-builder.ts'
import { ProfileFillerError } from '../errors.ts'
import type { CvProfile, ResolvedClient } from '../types.ts'

export function runProfileBuilderTests() {
  const client: ResolvedClient = {
    clientId: 45, clientName: 'Test', currentStatus: 'on en market', market: 'En',
    stack: 'Java', dolphinProfileId: 1, cvUrl: 'https://docs.google.com/document/d/x',
    cvRevision: '1', contacts: { email: 'noco@example.com', phone: '+222',
      telegram: '@noco', other: [] }, fallbacks: { fullName: 'Noco Name', location: 'Belgrade',
        education: '[{"uni":"Noco University","faculty":"CS","yearOfEnd":"2016"}]',
        englishLevel: 'B2' },
    credentials: {}
  }
  const cv: CvProfile = {
    language: 'en', fullName: 'CV Name', location: 'London', position: 'Engineer',
    contacts: { email: 'cv@example.com', phone: '+111', telegram: '@cv', other: [] },
    summary: 'Summary text.',
    skillGroups: [{ category: 'Backend', items: ['Java', 'Spring'],
      sourceText: 'Backend: Java, Spring' }],
    skills: ['Java', 'Spring'],
    experience: [{ company: 'Employer', title: 'Engineer', current: true,
      description: 'Built systems.', technologies: ['Java'],
      namedOrganizations: ['Vendor', 'Product Brand'] }],
    education: [], languages: [{ name: 'English', level: 'B2' }],
    namedOrganizations: ['Partner']
  }
  const prepared = buildPreparedProfile(client, cv, '2026-09-03T00:00:00Z')
  assert.equal(prepared.cv.location, 'Tbilisi, Georgia')
  assert.equal(prepared.cv.contacts.email, 'cv@example.com')
  assert.equal(prepared.cv.contacts.phone, '+111')
  assert.match(prepared.about, /^Contacts\n/)
  assert.match(prepared.about, /\n\nSummary\nSummary text\.\n\nSkills\nBackend: Java, Spring$/)
  assert.deepEqual(prepared.employerCandidates.map(item => item.name),
    ['Employer', 'Vendor', 'Product Brand', 'Partner'])
  assert.equal(prepared.cv.education[0].institution, 'Noco University')
  assert.deepEqual(prepared.cv.languages, [{ name: 'English', level: 'B2' }])

  const ruClient: ResolvedClient = {
    ...client, clientId: 170, clientName: 'Аблена Дементьева', market: 'Ru',
    currentStatus: 'on ru market', fallbacks: { firstName: 'Елена', lastName: 'Дементьева' }
  }
  const wrongCv: CvProfile = {
    ...cv, language: 'ru', fullName: 'Дмитрий Овчинников', firstName: 'Дмитрий',
    lastName: 'Овчинников'
  }
  assert.throws(() => buildPreparedProfile(ruClient, wrongCv), (error: unknown) =>
    error instanceof ProfileFillerError && error.code === 'profile_cv_identity_mismatch' &&
    error.stage === 'validate_sources')
  const overridden = buildPreparedProfile(ruClient, {
    ...wrongCv, birthDate: '2026-08-03'
  }, '2026-09-04T00:00:00Z', { useNocoIdentity: true })
  assert.equal(overridden.cv.fullName, 'Елена Дементьева')
  assert.equal(overridden.cv.firstName, 'Елена')
  assert.equal(overridden.cv.lastName, 'Дементьева')
  assert.equal(overridden.cv.birthDate, undefined)
  assert.equal(overridden.cv.contacts.email, 'cv@example.com')
}
