<script setup>
import { computed, nextTick, ref } from 'vue'
import Card from 'primevue/card'
import { studentProfileDraft, workPlacesSavePayload } from './student-profile-draft.js'
import { validateWorkPlaces } from '../../student-profile-validation.ts'
import './student-profile.css'

const props = defineProps({ client: { type: Object, required: true }, save: { type: Function, required: true } })
const emit = defineEmits(['saved'])
const draft = ref([])
const editing = ref(false), saving = ref(false), submitted = ref(false), failure = ref(''), success = ref('')
const validation = computed(() => validateWorkPlaces(draft.value))
const error = computed(() => submitted.value ? validation.value.error : '')
const editorElement = ref(null)
const savedRows = computed(() => studentProfileDraft(props.client).workPlaces)
function focusEditor() {
  editorElement.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  editorElement.value?.querySelector('input,button')?.focus({ preventScroll: true })
}
async function openEditor() {
  draft.value = studentProfileDraft(props.client).workPlaces
  submitted.value = false; failure.value = ''; success.value = ''; editing.value = true
  await nextTick()
  focusEditor()
}
function cancel() {
  if (saving.value) return
  editing.value = false; submitted.value = false; failure.value = ''
}
async function submit() {
  if (saving.value) return
  submitted.value = true; failure.value = ''; success.value = ''
  if (validation.value.error) { await nextTick(); focusEditor(); return }
  saving.value = true
  try {
    const result = await props.save(workPlacesSavePayload(validation.value.value))
    editing.value = false
    emit('saved', result)
    success.value = 'Места работы сохранены'
  } catch (error) { failure.value = error?.message || 'Не удалось сохранить места работы. Попробуйте ещё раз.' }
  finally { saving.value = false }
}
</script>

<template>
  <Card class="workplaces-card" data-testid="workplaces-card">
    <template #title>
      <div class="workplaces-heading">
        <span>Места работы</span>
        <button v-if="!editing" type="button" class="student-button" data-testid="open-workplaces-editor-button" @click="openEditor">Редактировать</button>
      </div>
    </template>
    <template #content>
      <section class="student-profile student-workplaces">
        <p class="student-info">Список используется для <strong>стоп-листа</strong>: в эти компании мы не будем отправлять отклики. Отметьте «Сейчас работаю» для текущего места работы.</p>
        <p v-if="success" class="student-success" role="status">{{ success }}</p>
        <form v-if="editing" ref="editorElement" novalidate data-testid="workplaces-editor" @submit.prevent="submit">
          <p v-if="failure" class="student-error-summary" role="alert">{{ failure }}</p>
          <fieldset class="student-form-body" :disabled="saving">
            <div :class="{ invalid: error }">
              <div v-for="(place, index) in draft" :key="index" class="student-work-row">
                <input v-model="place.companyName" :aria-label="`Название компании ${index + 1}`" placeholder="Название компании" :aria-invalid="Boolean(error)" :aria-describedby="error ? 'workplaces-error' : undefined" :data-testid="`work-company-${index}`" />
                <label class="student-checkbox" :class="{ 'is-current': place.isCurrent }"><input v-model="place.isCurrent" type="checkbox" :data-testid="`work-current-${index}`" />Сейчас работаю</label>
                <button type="button" class="student-icon-button" :aria-label="`Удалить место работы ${index + 1}`" :data-testid="`remove-work-${index}`" @click="draft.splice(index, 1)">×</button>
              </div>
              <button type="button" class="student-button" :disabled="draft.length >= 20" data-testid="add-work-place" @click="draft.push({ companyName: '', isCurrent: false })">+ Добавить место работы</button>
              <small v-if="error" id="workplaces-error" class="student-error" role="alert">{{ error }}</small>
            </div>
            <div class="student-form-actions">
              <button type="button" class="student-button" data-testid="cancel-workplaces-button" @click="cancel">Отмена</button>
              <button type="submit" class="student-button primary" :disabled="saving" data-testid="save-workplaces-button">{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button>
            </div>
          </fieldset>
        </form>
        <div v-else data-testid="workplaces-view">
          <p v-if="!savedRows.length" class="student-hint">Места работы не указаны</p>
          <ul v-else class="student-workplaces-list"><li v-for="(place, index) in savedRows" :key="index">{{ place.companyName }} <span v-if="place.isCurrent" class="student-current-badge">сейчас</span></li></ul>
        </div>
      </section>
    </template>
  </Card>
</template>

<style scoped>
.workplaces-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.student-workplaces-list { margin: 0; padding-left: 20px; }
.student-workplaces-list li { padding: 5px 0; overflow-wrap: anywhere; }
</style>
