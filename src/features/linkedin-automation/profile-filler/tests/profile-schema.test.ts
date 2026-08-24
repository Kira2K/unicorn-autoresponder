const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const path = join(__dirname, '..', 'profile-input.schema.json')
const schema = JSON.parse(readFileSync(path, 'utf8'))
const definitions = schema.$defs

assert.equal(schema.properties.schema_version.const, 1)
assert.deepEqual(definitions.experienceData.required, ['company', 'job_title'])
assert.deepEqual(definitions.educationData.required, ['school'])
assert.deepEqual(definitions.experienceData.properties.workplace_type.enum,
  ['ON_SITE', 'HYBRID', 'REMOTE'])
assert.ok(definitions.experienceData.properties.source_of_hire.enum.includes('LINKEDIN'))
assert.deepEqual(definitions.openToWork.required,
  ['job_titles', 'workplace_types', 'locations', 'employment_types', 'visibility'])
assert.deepEqual(definitions.openToWork.properties.visibility.enum, ['ALL', 'RECRUITERS_ONLY'])
assert.equal(definitions.skills.properties.target_count.minimum, 95)
assert.equal(definitions.skills.properties.target_count.maximum, 103)

console.log('profile JSON schema tests passed')
