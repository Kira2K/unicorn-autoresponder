const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { MCP_ENUMS, REQUIRED_ID_FIELDS } = require('../mcp-contract.ts') as any

const path = join(__dirname, '..', 'profile-input.schema.json')
const schema = JSON.parse(readFileSync(path, 'utf8'))
const definitions = schema.$defs

assert.equal(schema.properties.schema_version.const, 1)
assert.deepEqual(definitions.experienceData.required, ['company', 'job_title'])
assert.deepEqual(definitions.educationData.required, ['school'])
assert.ok(definitions.experienceData.properties.source_of_hire.enum.includes('LINKEDIN'))
assert.deepEqual(definitions.openToWork.required,
  ['job_titles', 'workplace_types', 'locations', 'employment_types', 'visibility'])
assert.deepEqual(definitions.openToWork.properties.visibility.enum, ['ALL', 'RECRUITERS_ONLY'])
assert.equal(definitions.skills.properties.target_count.minimum, 95)
assert.equal(definitions.skills.properties.target_count.maximum, 103)
assert.equal(Object.hasOwn(definitions.parameter.properties, 'id'), false)
assert.equal(Object.hasOwn(definitions.experienceData.properties, 'employment_type'), false)
assert.equal(definitions.openToWork.properties.locations['x-unipile-catalog'], 'LOCATION')
assert.deepEqual(definitions.experienceData.properties.workplace_type.enum,
  [...MCP_ENUMS.workplaceType])
assert.deepEqual(definitions.openToWork.properties.employment_types.items.enum,
  [...MCP_ENUMS.employmentType])
assert.equal(definitions.openToWork.properties.job_titles['x-unipile-catalog'],
  REQUIRED_ID_FIELDS.openToWorkJobTitle)

console.log('profile JSON schema tests passed')
