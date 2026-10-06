import { formatBirthDate } from '../../student-profile-validation.ts'

const companies = value => String(value || '').split(',').map(name => name.trim()).filter(Boolean)
export function studentProfileDraft(client) {
  const current = new Set(companies(client.currentCompany).map(name => name.toLowerCase()))
  const ordered = [...companies(client.stopListCompany), ...companies(client.currentCompany), ...companies(client.previousCompanies)]
  const seen = new Set()
  const workPlaces = ordered.filter(name => {
    const key = name.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true
  }).map(companyName => ({ companyName, isCurrent: current.has(companyName.toLowerCase()) }))
  const emptyEducation = { uni: '', faculty: '', grade: '', yearOfEnd: '' }
  return {
    firstName: client.firstName || '', lastName: client.lastName || '', middleName: client.middleName || '',
    birthDate: formatBirthDate(client.birthDate), englishLevelId: client.englishLevelId ? String(client.englishLevelId) : '',
    readyForInterviewInEnglishIn2Months: ['Yes', 'No'].includes(client.readyForInterviewInEnglishIn2Months) ? client.readyForInterviewInEnglishIn2Months : '',
    noHigherEducation: client.noHigherEducation === true,
    educationEntries: client.noHigherEducation ? [{ ...emptyEducation }] : client.educationEntries?.length
      ? client.educationEntries.map(row => ({ ...emptyEducation, ...row })) : [{ ...emptyEducation, uni: client.education || '' }],
    realLocation: client.realLocation || '', desiredLocation: client.desiredLocation || '',
    calendarEmail: client.calendarEmail || '', telegramPersonalChatId: client.telegramPersonalChatId || '', workPlaces
  }
}

export function studentProfileSavePayload(profile) {
  return {
    ...profile,
    education: profile.noHigherEducation ? null : profile.educationEntries.map(row => [row.uni, row.faculty, row.grade, row.yearOfEnd].join(', ')).join('\n'),
    ...workPlacesSavePayload(profile.workPlaces)
  }
}

export function workPlacesSavePayload(workPlaces) {
  return {
    stopListCompany: workPlaces.map(row => row.companyName).join(','),
    currentCompany: workPlaces.filter(row => row.isCurrent).map(row => row.companyName).join(','),
    previousCompanies: workPlaces.filter(row => !row.isCurrent).map(row => row.companyName).join(',')
  }
}
