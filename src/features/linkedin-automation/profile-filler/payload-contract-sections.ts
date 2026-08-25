import type { JsonObject, ValidationIssue } from './input-types.ts'
import { MCP_ENTRY_REQUIRED, MCP_ENUMS, PAYLOAD_FIELDS } from './mcp-contract.ts'
import {
  booleanField, dateField, enumField, fatal, named, namedList, onlyFields, record,
  requiredFields, stringField
} from './payload-contract-shared.ts'

export function validateExperience(value: JsonObject, path: string, issues: ValidationIssue[]) {
  onlyFields(value, PAYLOAD_FIELDS.experience, path, issues)
  const operation = value.operation
  if (operation === 'create') requiredFields(value, MCP_ENTRY_REQUIRED.experience.create, path, issues)
  else if (operation === 'edit') requiredFields(value, MCP_ENTRY_REQUIRED.experience.edit, path, issues)
  else fatal(issues, `${path}.operation`, 'Expected create or edit.')
  if (value.id !== undefined) stringField(value.id, `${path}.id`, issues)
  booleanField(value.notify_network, `${path}.notify_network`, issues)
  if (value.job_title !== undefined) named(value.job_title, `${path}.job_title`, issues)
  if (value.company !== undefined) named(value.company, `${path}.company`, issues)
  if (value.location !== undefined) named(value.location, `${path}.location`, issues)
  enumField(value.workplace_type, MCP_ENUMS.workplaceType, `${path}.workplace_type`, issues)
  enumField(value.source_of_hire, MCP_ENUMS.sourceOfHire, `${path}.source_of_hire`, issues)
  if (value.start_date !== undefined) dateField(value.start_date, `${path}.start_date`, issues)
  if (value.end_date !== undefined) dateField(value.end_date, `${path}.end_date`, issues)
  if (value.skills !== undefined) namedList(value.skills, `${path}.skills`, issues)
  if (value.description !== undefined) stringField(value.description, `${path}.description`, issues, true)
}

export function validateEducation(value: JsonObject, path: string, issues: ValidationIssue[]) {
  onlyFields(value, PAYLOAD_FIELDS.education, path, issues)
  const operation = value.operation
  if (operation === 'create') requiredFields(value, MCP_ENTRY_REQUIRED.education.create, path, issues)
  else if (operation === 'edit') requiredFields(value, MCP_ENTRY_REQUIRED.education.edit, path, issues)
  else fatal(issues, `${path}.operation`, 'Expected create or edit.')
  if (value.id !== undefined) stringField(value.id, `${path}.id`, issues)
  booleanField(value.notify_network, `${path}.notify_network`, issues)
  for (const field of ['school', 'degree', 'field_of_study']) {
    if (value[field] !== undefined) named(value[field], `${path}.${field}`, issues)
  }
  if (value.start_date !== undefined) dateField(value.start_date, `${path}.start_date`, issues)
  if (value.end_date !== undefined) dateField(value.end_date, `${path}.end_date`, issues)
  if (value.skills !== undefined) namedList(value.skills, `${path}.skills`, issues)
  for (const field of ['grade', 'activities', 'description']) {
    if (value[field] !== undefined) stringField(value[field], `${path}.${field}`, issues, true)
  }
}

export function validateOpenToWork(value: JsonObject, path: string, issues: ValidationIssue[]) {
  onlyFields(value, ['job_title', 'workplace', 'start_date', 'employment_type', 'visibility'],
    path, issues)
  requiredFields(value, ['job_title', 'workplace', 'visibility'], path, issues)
  if (!Array.isArray(value.job_title)) fatal(issues, `${path}.job_title`, 'Expected an array.')
  else value.job_title.forEach((item, index) => {
    if (!record(item)) { fatal(issues, `${path}.job_title[${index}]`, 'Expected title and id.'); return }
    requiredFields(item, ['title', 'id'], `${path}.job_title[${index}]`, issues)
    onlyFields(item, ['title', 'id'], `${path}.job_title[${index}]`, issues)
    stringField(item.title, `${path}.job_title[${index}].title`, issues)
    stringField(item.id, `${path}.job_title[${index}].id`, issues)
  })
  if (!Array.isArray(value.workplace)) fatal(issues, `${path}.workplace`, 'Expected an array.')
  else value.workplace.forEach((item, index) => validateWorkplace(item, `${path}.workplace[${index}]`, issues))
  enumField(value.start_date, MCP_ENUMS.startDate, `${path}.start_date`, issues)
  enumField(value.visibility, MCP_ENUMS.visibility, `${path}.visibility`, issues)
  if (value.employment_type !== undefined) {
    if (!Array.isArray(value.employment_type)) fatal(issues, `${path}.employment_type`, 'Expected an array.')
    else value.employment_type.forEach((item, index) => enumField(item, MCP_ENUMS.employmentType,
      `${path}.employment_type[${index}]`, issues))
  }
}

function validateWorkplace(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!record(value)) { fatal(issues, path, 'Expected workplace object.'); return }
  requiredFields(value, ['type', 'location'], path, issues)
  onlyFields(value, ['type', 'location'], path, issues)
  enumField(value.type, MCP_ENUMS.workplaceType, `${path}.type`, issues)
  if (!Array.isArray(value.location)) fatal(issues, `${path}.location`, 'Expected location ID array.')
  else value.location.forEach((item, index) => stringField(item, `${path}.location[${index}]`, issues))
}
