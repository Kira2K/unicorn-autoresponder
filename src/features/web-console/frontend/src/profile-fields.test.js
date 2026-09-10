import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { useProfileFields } from './use-profile-fields.js'
import { comparisonGroups } from './profile-comparison-view.js'
import './profile-sections.test.js'
const original = { jobId: 'one', planHash: 'first', status: 'preview_ready', preview: {
  document: { profile: { headline: 'Engineer', about: 'Full description' } }, steps: [], issues: [] } }
const job = ref(structuredClone(original))
let calls = 0, fail = true, finish
const api = { async editAdminProfileField(id, hash, path, value) {
  calls++
  assert.equal(id, 'one'); assert.equal(hash, 'first')
  if (fail) throw { body: { issues: [{ path, message: 'Исправьте поле', level: 'fatal' }] } }
  await new Promise(resolve => { finish = resolve })
  return { ...original, planHash: 'second' }
}, async selectAdminProfileField(id, hash, path, enabled) {
  calls++
  assert.equal(id, 'one'); assert.equal(hash, 'second')
  await new Promise(resolve => { finish = resolve })
  return { ...original, planHash: 'selected', preview: { ...original.preview, disabledFields: enabled ? [] : [path] } }
} }
const fields = useProfileFields(api, { job, error: ref(''), observe(value, refresh) {
  assert.equal(refresh, false, 'field response is authoritative; no extra polling GET')
  job.value = value
} })
try {
  fields.change('profile.headline', 'Changed')
  fields.change('profile.about', 'Another unsaved field')
  assert.equal(calls, 0, 'typing never starts a request')
  assert(fields.dirty.value)
  await fields.save('profile.headline')
  assert.equal(fields.values.value['profile.headline'], 'Changed', 'error preserves text')
  assert.equal(comparisonGroups(original.preview, null, fields)[0].status, 'blocker')
  fail = false
  const saving = fields.save('profile.headline')
  await fields.save('profile.headline')
  assert.equal(calls, 2, 'double blur does not double-save')
  finish(); await saving
  assert.equal(job.value.planHash, 'second')
  assert.equal(fields.values.value['profile.about'], 'Another unsaved field')
  assert(fields.dirty.value, 'another draft must continue blocking Apply')
  fields.discard('profile.about')
  assert(!fields.dirty.value)
  const selection = fields.select('profile.headline', false)
  await fields.select('profile.headline', false)
  assert.equal(calls, 3, 'checkbox double click is serialized')
  finish(); await selection
  assert.equal(job.value.planHash, 'selected')
  const group = comparisonGroups(job.value.preview, null, fields)[0]
  assert.equal(group.status, 'excluded')
  assert.equal(group.entries[0].fields[0].value, 'Engineer', 'unchecked field keeps its content')
  fields.change('profile.headline', 'Private draft')
  job.value = { ...original, jobId: 'another-author' }
  await nextTick()
  assert.deepEqual(fields.values.value, {}, 'drafts never cross jobs or authors')
  job.value.status = 'verifying'
  fields.change('profile.headline', 'Not allowed')
  assert(!fields.dirty.value)
} finally { fields.dispose() }
console.log('profile inline edit state tests passed')
