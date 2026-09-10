import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useProfileFields } from './use-profile-fields.js'
import { comparisonGroups } from './profile-comparison-view.js'
import { splitProfileDate, joinProfileDate, completeProfileDate } from './profile-date-value.js'

assert.deepEqual(splitProfileDate('2021'), { year: '2021', month: '', current: false })
assert.equal(joinProfileDate(splitProfileDate('2021')), '2021', 'no invented month')
assert.equal(joinProfileDate({ month: '09', year: '' }), '-09', 'no invented year')
assert(!completeProfileDate('2021')); assert(!completeProfileDate('-09'))
assert(!completeProfileDate('2021-13')); assert(!completeProfileDate('2021-00'))
assert(completeProfileDate('2021-09')); assert(completeProfileDate('present', true))
assert(!completeProfileDate('present')); assert(!completeProfileDate('2021-09-15'))
for (const year of ['2', '20', '202', '2021', '20210']) {
  assert.equal(splitProfileDate(`${year}-09`).year, year, 'typing never clears partial or invalid years')
  assert.equal(joinProfileDate(splitProfileDate(`${year}-09`)), `${year}-09`)
  assert.equal(completeProfileDate(`${year}-09`), year === '2021')
}

const path = 'profile.education[0].data.end_date'
const job = ref({ jobId: 'sections', planHash: 'one', status: 'preview_ready', preview: {
  document: { profile: { headline: 'Engineer', education: [{ data: { school: 'University', end_date: '2021' } }] } },
  disabledFields: [], steps: [], issues: [{ level: 'fatal', path, message: 'Укажите месяц.' }] } })
let fail = true, calls = 0
const editor = useProfileFields({
  async editAdminProfileField() { throw Error('selection must never save a draft') },
  async selectAdminProfileField(_id, hash, section, enabled) {
    assert.equal(hash, job.value.planHash); assert.equal(section, 'profile.education'); calls++
    if (fail) throw { body: { error: 'linkedin_provider_id_mismatch' } }
    return { ...job.value, planHash: `selected-${calls}`,
      preview: { ...job.value.preview, disabledFields: enabled ? [] : [section] } }
  }
}, { job, error: ref(''), observe(value) { job.value = value } })
try {
  editor.change(path, '2021-09')
  await editor.select('profile.education', false)
  assert.equal(calls, 1, 'an unsaved date does not block the checkbox')
  assert(editor.dirty.value)
  assert.match(editor.issues.value['profile.education'][0].message, /владельца профиля/)
  assert(comparisonGroups(job.value.preview, null, editor).find(group => group.section === 'education').enabled)
  fail = false
  await editor.select('profile.education', false)
  assert(!editor.dirty.value, 'excluded drafts do not block other sections')
  assert.equal(editor.values.value[path], '2021-09', 'selection never discards a local draft')
  const education = comparisonGroups(job.value.preview, null, editor).find(group => group.section === 'education')
  assert.equal(education.status, 'excluded'); assert.equal(education.entries[0].status, 'excluded')
  assert.equal(education.entries[0].fields.find(field => field.path === path).value, '2021')
  await editor.save(path)
  await editor.select('profile.education', true)
  assert(editor.dirty.value, 're-enabled draft must be confirmed')
  assert.equal(editor.values.value[path], '2021-09')
  editor.discard(path)
  await editor.select('profile.education', false)
  assert(!editor.dirty.value, 'cancel then uncheck works too')
  assert.equal(calls, 4)
} finally { editor.dispose() }
console.log('profile section selection and date tests passed')
