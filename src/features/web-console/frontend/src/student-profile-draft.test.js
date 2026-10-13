import assert from 'node:assert/strict'
import { test } from 'node:test'
import { studentProfileDraft, studentProfileSavePayload, workPlacesSavePayload } from './student-profile-draft.js'
import { validateStudentProfile } from '../../student-profile-validation.ts'

test('existing company columns restore workplace order and current flags without new tables', () => {
  const source = { currentCompany: 'Yandex', previousCompanies: 'Sber', stopListCompany: 'Sber,Yandex,sber', birthDate: '2000-04-20' }
  const draft = studentProfileDraft(source)
  assert.deepEqual(draft.workPlaces, [{ companyName: 'Sber', isCurrent: false }, { companyName: 'Yandex', isCurrent: true }])
  assert.equal(draft.birthDate, '20.04.2000')
  const profile = validateStudentProfile({ ...draft, noHigherEducation: true }, { today: '2026-10-05', englishLevelIds: [] }).value
  const payload = workPlacesSavePayload(profile.workPlaces)
  assert.equal(payload.stopListCompany, 'Sber,Yandex')
  assert.equal(payload.currentCompany, 'Yandex'); assert.equal(payload.previousCompanies, 'Sber')
  assert.deepEqual(studentProfileDraft(payload).workPlaces, draft.workPlaces)
})

test('old education remains incomplete rather than being marked as no higher education', () => {
  const draft = studentProfileDraft({ education: 'Legacy university', realAge: 0 })
  assert.equal(draft.noHigherEducation, false)
  assert.equal(draft.educationEntries[0].uni, 'Legacy university')
  assert.equal(draft.educationEntries[0].faculty, '')
})

test('other education payload and draft keep city and remove higher-only values', () => {
  const entry = { uni: 'School', faculty: '', grade: '', yearOfEnd: '2020', city: 'Москва' }
  const draft = studentProfileDraft({ noHigherEducation: true, educationEntries: [entry] })
  const payload = studentProfileSavePayload(draft)
  assert.deepEqual(payload.educationEntries, [entry])
  assert.equal(payload.education, 'School, 2020, Москва')
  assert.deepEqual(studentProfileDraft(payload).educationEntries, [entry])
  const higher = studentProfileSavePayload({ ...draft, noHigherEducation: false })
  assert.equal(Object.hasOwn(higher.educationEntries[0], 'city'), false)
})

test('legacy null education does not imply an explicit opt out', () => {
  const draft = studentProfileDraft({ education: null, educationEntries: null })
  assert.equal(draft.noHigherEducation, false)
  assert.ok(validateStudentProfile(draft, { englishLevelIds: [] }).errors.educationEntries)
})

test('workplace selections replace both lists after toggling, deletion and clearing', () => {
  const draft = studentProfileDraft({ currentCompany: 'Alpha,Beta', previousCompanies: 'Gamma,Delta' })
  const payload = () => workPlacesSavePayload(draft.workPlaces)
  assert.equal(payload().currentCompany, 'Alpha,Beta')
  assert.equal(payload().previousCompanies, 'Gamma,Delta')
  draft.workPlaces[0].isCurrent = false
  draft.workPlaces[2].isCurrent = true
  draft.workPlaces.pop()
  assert.equal(payload().currentCompany, 'Beta,Gamma')
  assert.equal(payload().previousCompanies, 'Alpha')
  assert.equal(payload().stopListCompany, 'Alpha,Beta,Gamma')
  assert.deepEqual(studentProfileDraft(payload()).workPlaces, draft.workPlaces)
  draft.workPlaces = []
  assert.equal(payload().currentCompany, '')
  assert.equal(payload().previousCompanies, '')
  assert.equal(payload().stopListCompany, '')
  assert.deepEqual(studentProfileDraft(payload()).workPlaces, [])
})

test('personal and workplace patches contain only their own section fields', () => {
  const personal = studentProfileSavePayload({ firstName: 'Кира', noHigherEducation: true, workPlaces: [{ companyName: 'Alpha', isCurrent: true }], currentCompany: 'Old', previousCompanies: 'Old', stopListCompany: 'Old' })
  assert.equal(personal.firstName, 'Кира')
  for (const field of ['workPlaces', 'currentCompany', 'previousCompanies', 'stopListCompany']) assert.equal(Object.hasOwn(personal, field), false)
  assert.deepEqual(workPlacesSavePayload([{ companyName: 'Alpha', isCurrent: true }, { companyName: 'Beta', isCurrent: false }]), {
    stopListCompany: 'Alpha,Beta', currentCompany: 'Alpha', previousCompanies: 'Beta'
  })
})
