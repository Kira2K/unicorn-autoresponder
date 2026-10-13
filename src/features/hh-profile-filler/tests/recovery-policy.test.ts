import assert from 'node:assert/strict'
import { educationContentMatches, experienceContentMatches } from '../content-policy.ts'
import { educationLevel } from '../education-policy.ts'

export function runRecoveryPolicyTests() {
  const bachelor = { institution: 'University', degree: 'Bachelor of Science', graduationYear: 2020 }
  const master = { ...bachelor, degree: 'Магистр', graduationYear: 2022 }
  assert.equal(educationContentMatches('University 2020 Bachelor', bachelor), true)
  assert.equal(educationContentMatches('University 2020 Бакалавр', bachelor), true)
  assert.equal(educationContentMatches('University 2020 Master', bachelor), false)
  assert.equal(educationContentMatches('University 2021 Bachelor', bachelor), false)
  assert.equal(educationContentMatches('University 2022 Master', master), true)
  assert.equal(educationContentMatches('Other 2022 Master', master), false)
  assert.equal(educationLevel('Master of Science'), 'master')
  const bulletItem = { company: 'Acme', title: 'Engineer', current: false,
    description: 'Company. ● Built 6 services. ● Cut latency by 40%.', technologies: [], namedOrganizations: [] }
  assert.equal(experienceContentMatches('Acme Engineer Company. - Built 6 services. - Cut latency by 40%.', bulletItem), true)
  assert.equal(experienceContentMatches('Acme Engineer Company. - Built 5 services. - Cut latency by 40%.', bulletItem), false)
  assert.equal(experienceContentMatches('Acme Engineer Февраль 2024 — сейчас Description', {
    company: 'Acme', title: 'Engineer', startDate: '02/2024', endDate: 'Present', current: true,
    description: 'Description', technologies: [], namedOrganizations: []
  }), true)
}
