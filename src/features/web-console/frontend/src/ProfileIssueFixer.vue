<script setup>
import { computed, reactive } from 'vue'
import { api } from './api'
import { readProfilePath } from './profile-fixes'

const props = defineProps({
  accountId: { type: Number, required: true }, document: { type: Object, required: true },
  issues: { type: Array, default: () => [] }
})
const emit = defineEmits(['resolve'])
const state = reactive({})
const rows = computed(() => props.issues.filter(issue =>
  issue.path?.endsWith('.job_title') || issue.path?.endsWith('.company') ||
  /\.skills(?:\.add)?\[\d+\]$/.test(issue.path)))

function row(issue) {
  if (!state[issue.path]) state[issue.path] = {
    query: String(readProfilePath(props.document, issue.path) ?? ''),
    options: issue.suggestions || [], selected: '', ignored: false, loading: false, error: ''
  }
  return state[issue.path]
}

const isSkill = issue => issue.path.includes('.skills')
const isCompany = issue => issue.path.endsWith('.company')
const label = issue => isSkill(issue) ? 'Skill' : isCompany(issue) ? 'Company' : 'Job title'
const ready = computed(() => rows.value.length && rows.value.every(issue => {
  const value = row(issue)
  return Boolean(value.selected || ((isSkill(issue) || isCompany(issue)) && value.ignored))
}))

async function search(issue) {
  const value = row(issue)
  value.loading = true; value.error = ''
  try {
    const result = await api.adminProfileParameters(props.accountId,
      isSkill(issue) ? 'SKILL' : isCompany(issue) ? 'COMPANY' : 'JOB_TITLE', value.query)
    value.options = result.items.map(item => item.name)
    if (!value.options.length) value.error = 'No LinkedIn options found. Try another wording.'
  } catch (error) { value.error = error.message || 'Search failed.' }
  finally { value.loading = false }
}

function submit() {
  const fixes = rows.value.flatMap(issue => {
    const value = row(issue)
    if (isCompany(issue) && value.ignored) return []
    return [{ path: issue.path, ...(value.ignored ? { remove: true } : { value: value.selected }) }]
  })
  emit('resolve', fixes)
}
</script>

<template>
  <section v-if="rows.length" class="profile-issue-fixer" data-testid="profile-issue-fixer">
    <h4>Fix fields before Apply</h4>
    <article v-for="issue in rows" :key="issue.path">
      <strong>{{ label(issue) }}</strong>
      <small>{{ issue.path }}</small>
      <div class="profile-fix-search">
        <input v-model="row(issue).query" :aria-label="`Search ${issue.path}`" />
        <Button label="Search LinkedIn" size="small" :loading="row(issue).loading"
          :disabled="row(issue).query.trim().length < 2" @click="search(issue)" />
      </div>
      <select v-model="row(issue).selected" @change="row(issue).ignored = false">
        <option value="">Choose a LinkedIn value</option>
        <option v-for="option in row(issue).options" :key="option" :value="option">{{ option }}</option>
      </select>
      <Button v-if="isSkill(issue) || isCompany(issue)"
        :label="isSkill(issue) ? 'Exclude this Skill' : 'Keep company as typed'"
        severity="secondary" text @click="row(issue).ignored = true; row(issue).selected = ''" />
      <small v-if="row(issue).ignored" class="profile-fix-ok">
        {{ isSkill(issue) ? 'Will be excluded.' : 'Current company text will be kept.' }}
      </small>
      <small v-if="row(issue).error" class="profile-fix-error">{{ row(issue).error }}</small>
    </article>
    <Button label="Save fixes and rebuild Preview" :disabled="!ready"
      data-testid="profile-fixes-submit" @click="submit" />
  </section>
</template>
