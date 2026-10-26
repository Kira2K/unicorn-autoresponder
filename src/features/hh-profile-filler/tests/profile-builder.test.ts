import assert from 'node:assert/strict'
import { buildPreparedProfile } from '../profile-builder.ts'
import { ProfileFillerError } from '../errors.ts'
import type { CvProfile, ResolvedClient } from '../types.ts'

export function runProfileBuilderTests() {
  const client: ResolvedClient = {
    clientId: 45, clientName: 'Test', currentStatus: 'on en market', market: 'En',
    stack: 'Java', dolphinProfileId: 1, cvUrl: 'https://docs.google.com/document/d/x',
    cvRevision: '1', stopListCompanies: ['Noco Stop', 'vendor'],
    contacts: { email: 'noco@example.com', phone: '+222',
      telegram: '@noco', other: [] }, fallbacks: { fullName: 'Noco Name', location: 'Belgrade',
        education: '[{"uni":"Noco University","faculty":"CS","yearOfEnd":"2016"}]',
        englishLevel: 'B2', birthDate: '1990-04-20' },
    credentials: {}
  }
  const cv: CvProfile = {
    language: 'en', fullName: 'CV Name', location: 'London', position: 'Engineer', birthDate: '1995-04-20',
    contacts: { email: 'cv@example.com', phone: '+111', telegram: '@cv', other: [] },
    summary: 'Summary text.',
    skillGroups: [{ category: 'Backend', items: ['Java', 'Spring'],
      sourceText: 'Backend: Java, Spring' }],
    skills: ['Java', 'Spring'],
    experience: [{ company: 'Employer', title: 'Engineer', current: true, startDate: '06/2018',
      description: 'Built systems.', technologies: ['Java', 'PostgreSQL'],
      namedOrganizations: ['Vendor', 'Product Brand'] }],
    education: [], languages: [{ name: 'English', level: 'B2' }],
    namedOrganizations: ['Partner']
  }
  const originalClient = structuredClone(client), originalCv = structuredClone(cv)
  const prepared = buildPreparedProfile(client, cv, '2026-09-03T00:00:00Z')
  assert.equal(prepared.cv.birthDate, '1995-04-20', 'The final CV birth date takes precedence over calculation and database')
  assert.deepEqual(client, originalClient)
  assert.deepEqual(cv, originalCv)
  for (const birthDate of [undefined, '', '   ']) {
    assert.equal(buildPreparedProfile(client, { ...cv, birthDate }, '2026-09-03T00:00:00Z').cv.birthDate,
      '2000-06-01', 'Calculate from experience only when the CV birth date is absent')
  }
  for (const experience of [[], [{ ...cv.experience[0], startDate: undefined }]]) {
    assert.equal(buildPreparedProfile(client, { ...cv, experience }, '2026-09-03T00:00:00Z').cv.birthDate,
      '1995-04-20', 'A CV birth date does not require calculation or job dates')
    assert.throws(() => buildPreparedProfile(client, { ...cv, experience, birthDate: undefined }, '2026-09-03T00:00:00Z'),
      (error: unknown) => error instanceof ProfileFillerError &&
        error.code === 'profile_legend_birth_date_unavailable',
      'Missing CV and job dates must not silently select a database birth date')
  }
  assert.equal(buildPreparedProfile(client, { ...cv, birthDate: '20.04.1995' }, '2026-09-03T00:00:00Z').cv.birthDate,
    '1995-04-20')
  for (const birthDate of ['unknown', '2026-08-03', '31.02.1995', '2027-01-01']) {
    assert.throws(() => buildPreparedProfile(client, { ...cv, birthDate }, '2026-09-03T00:00:00Z'),
      (error: unknown) => error instanceof ProfileFillerError && error.code === 'profile_cv_birth_date_invalid',
      'An explicitly invalid CV date must be corrected rather than silently replaced by calculation')
  }
  assert.equal(prepared.cv.location, 'Tbilisi, Georgia')
  assert.equal(prepared.cv.contacts.email, 'cv@example.com')
  assert.equal(prepared.cv.contacts.phone, '+111')
  assert.deepEqual(prepared.cv.skills, ['Java', 'Spring', 'PostgreSQL'])
  assert.match(prepared.about, /^Contacts\n/)
  assert.match(prepared.about, /\n\nSummary\nSummary text\.\n\nSkills\nBackend: Java, Spring$/)
  assert.deepEqual(prepared.employerCandidates.map(item => item.name),
    ['Noco Stop', 'vendor'])
  assert.deepEqual(prepared.employerCandidates.find(item => item.name === 'vendor')?.sources,
    ['noco:stop_list_company'])
  assert.equal(prepared.cv.education[0].institution, 'Noco University')
  assert.deepEqual(prepared.cv.languages, [{ name: 'English', level: 'B2' }])

  const partialEducation = buildPreparedProfile({ ...client,
    fallbacks: { ...client.fallbacks,
      education: 'Noco University, graduation year 2016, Computer Science, bachelor' }
  }, { ...cv, education: [{ institution: 'Noco University', degree: 'Bachelor' }] },
  '2026-09-03T00:00:00Z')
  assert.deepEqual(partialEducation.cv.education, [{
    institution: 'Noco University', degree: 'Bachelor',
    specialization: 'Computer Science', graduationYear: 2016
  }])

  const singleExpandedInstitution = buildPreparedProfile({ ...client,
    fallbacks: { ...client.fallbacks,
      education: 'Short University Name, year 2024, Applied Informatics, bachelor' }
  }, { ...cv, education: [{ institution: 'The Expanded University Name', degree: 'Bachelor' }] },
  '2026-09-03T00:00:00Z')
  assert.equal(singleExpandedInstitution.cv.education[0].graduationYear, 2024)
  assert.equal(singleExpandedInstitution.cv.education[0].specialization, 'Applied Informatics')

  const cvEnglishWins = buildPreparedProfile({ ...client,
    fallbacks: { ...client.fallbacks, englishLevel: 'B1' }
  }, { ...cv, languages: [{ name: 'English', level: 'C1' }] },
  '2026-09-03T00:00:00Z')
  assert.deepEqual(cvEnglishWins.cv.languages, [{ name: 'English', level: 'C1' }])

  const defaultEnglish = buildPreparedProfile({ ...client,
    fallbacks: { ...client.fallbacks, englishLevel: undefined }
  }, { ...cv, languages: [] }, '2026-09-03T00:00:00Z')
  assert.deepEqual(defaultEnglish.cv.languages, [{ name: 'English', level: 'B2' }])

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
    ...wrongCv, birthDate: undefined
  }, '2026-09-04T00:00:00Z', { useNocoIdentity: true })
  assert.equal(overridden.cv.fullName, 'Елена Дементьева')
  assert.equal(overridden.cv.firstName, 'Елена')
  assert.equal(overridden.cv.lastName, 'Дементьева')
  assert.equal(overridden.cv.birthDate, '2000-06-01')
  assert.equal(overridden.cv.contacts.email, 'cv@example.com')
}
