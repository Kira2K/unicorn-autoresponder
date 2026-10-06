<script setup>
import { computed, ref } from 'vue'
import Card from 'primevue/card'
import { studentProfileDraft } from './student-profile-draft.js'

const props = defineProps({ client: { type: Object, required: true }, editing: Boolean, saving: Boolean, error: String })
const draft = defineModel('workPlaces', { type: Array, default: () => [] })
const editorElement = ref(null)
const savedRows = computed(() => studentProfileDraft(props.client).workPlaces)
function focusError() {
  editorElement.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  editorElement.value?.querySelector('input')?.focus({ preventScroll: true })
}
defineExpose({ focusError })
</script>

<template>
  <Card class="workplaces-card" data-testid="workplaces-card">
    <template #title>
      <span>Места работы</span>
    </template>
    <template #content>
      <section class="student-profile student-workplaces">
        <p class="student-info">Список используется для <strong>стоп-листа</strong>: в эти компании мы не будем отправлять отклики. Отметьте «Сейчас работаю» для текущего места работы.</p>
        <div v-if="editing" ref="editorElement" data-testid="workplaces-editor">
          <fieldset class="student-form-body" :disabled="saving">
            <div :class="{ invalid: error }">
              <div v-for="(place, index) in draft" :key="index" class="student-work-row">
                <input v-model="place.companyName" form="student-profile-form" :aria-label="`Название компании ${index + 1}`" placeholder="Название компании" :aria-invalid="Boolean(error)" :aria-describedby="error ? 'workplaces-error' : undefined" :data-testid="`work-company-${index}`" />
                <label class="student-checkbox" :class="{ 'is-current': place.isCurrent }"><input v-model="place.isCurrent" form="student-profile-form" type="checkbox" :data-testid="`work-current-${index}`" />Сейчас работаю</label>
                <button type="button" class="student-icon-button" :aria-label="`Удалить место работы ${index + 1}`" :data-testid="`remove-work-${index}`" @click="draft.splice(index, 1)">×</button>
              </div>
              <button type="button" class="student-button" :disabled="draft.length >= 20" data-testid="add-work-place" @click="draft.push({ companyName: '', isCurrent: false })">+ Добавить место работы</button>
              <small v-if="error" id="workplaces-error" class="student-error" role="alert">{{ error }}</small>
            </div>
          </fieldset>
        </div>
        <div v-else data-testid="workplaces-view">
          <p v-if="!savedRows.length" class="student-hint">Места работы не указаны</p>
          <ul v-else class="student-workplaces-list"><li v-for="(place, index) in savedRows" :key="index">{{ place.companyName }} <span v-if="place.isCurrent" class="student-current-badge">сейчас</span></li></ul>
        </div>
      </section>
    </template>
  </Card>
</template>

<style scoped>
.student-workplaces-list { margin: 0; padding-left: 20px; }
.student-workplaces-list li { padding: 5px 0; overflow-wrap: anywhere; }
</style>
