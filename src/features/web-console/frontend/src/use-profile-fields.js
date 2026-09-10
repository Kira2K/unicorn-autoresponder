import { computed, ref, watch } from 'vue'
import { profileRequestError } from './profile-generation-view.js'
import { fieldDisabled } from '../../../linkedin-automation/profile-filler/field-selection.ts'

export function useProfileFields(api, session) {
  const values = ref({})
  const issues = ref({})
  const saving = ref('')
  const excluded = path => fieldDisabled(session.job.value?.preview?.disabledFields || [], path)
  const dirty = computed(() => Object.keys(values.value).some(path => !excluded(path)))
  function reset() { values.value = {}; issues.value = {} }
  const unwatch = watch(() => session.job.value?.jobId, reset)
  function change(path, value) {
    if (saving.value || session.job.value?.status !== 'preview_ready') return
    values.value = { ...values.value, [path]: value }
    issues.value = { ...issues.value, [path]: [] }
  }
  function discard(path) {
    delete values.value[path]
    delete issues.value[path]
  }
  async function submit(path, select, enabled) {
    const job = session.job.value
    if (saving.value || job?.status !== 'preview_ready' ||
      (!select && (excluded(path) || !Object.hasOwn(values.value, path)))) return
    saving.value = path
    session.error.value = ''
    try {
      const result = select ? await api.selectAdminProfileField(job.jobId, job.planHash, path, enabled)
        : await api.editAdminProfileField(job.jobId, job.planHash, path, values.value[path])
      if (!select) discard(path)
      else delete issues.value[path]
      session.observe(result, false)
    } catch (error) {
      issues.value[path] = error.body?.issues?.length ? error.body.issues : [{ level: 'fatal', path,
        message: profileRequestError(error, select ? 'Не удалось сохранить выбор раздела. Повторите попытку.'
          : 'Не удалось проверить и сохранить поле. Правка осталась в редакторе.') }]
    } finally { saving.value = '' }
  }
  const save = path => submit(path, false)
  const select = (path, enabled) => submit(path, true, enabled)
  return { values, issues, saving, dirty, change, discard, save, select, reset, dispose: unwatch }
}
