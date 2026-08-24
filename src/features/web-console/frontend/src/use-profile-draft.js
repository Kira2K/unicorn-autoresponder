import { ref } from 'vue'
import { api } from './api'
import { readProfileFile } from './profile-file'
import { applyProfileFixes } from './profile-fixes'

const clone = value => value ? JSON.parse(JSON.stringify(value)) : null

export function useProfileDraft() {
  const document = ref(null)
  const dirty = ref(false)
  const issues = ref([])
  const selectedFile = ref(null)
  const valid = ref(false)

  function accept(analysis, changed) {
    document.value = clone(analysis.document)
    issues.value = analysis.issues || []
    valid.value = Boolean(analysis.valid)
    dirty.value = changed
    return analysis
  }

  async function load(file) {
    const selected = await readProfileFile(file)
    selectedFile.value = selected
    return accept(await api.analyzeAdminProfile(JSON.parse(selected.text)), false)
  }

  async function analyze() {
    if (!document.value) return { valid: false, issues: [] }
    return accept(await api.analyzeAdminProfile(document.value), dirty.value)
  }

  function update(value) {
    document.value = clone(value)
    dirty.value = true
    valid.value = false
  }

  function fix(values) { update(applyProfileFixes(document.value, values)) }

  function syncPreview(preview) {
    if (!preview?.document) return
    document.value = clone(preview.document)
    issues.value = preview.issues || []
    dirty.value = false
    valid.value = true
  }

  function reset() {
    document.value = null; dirty.value = false; issues.value = []
    selectedFile.value = null; valid.value = false
  }

  return { analyze, dirty, document, fix, issues, load, reset, selectedFile, syncPreview, update, valid }
}
