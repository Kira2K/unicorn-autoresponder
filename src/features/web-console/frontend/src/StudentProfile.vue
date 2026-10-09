<script setup>
import { computed, nextTick, ref, watch, watchEffect } from 'vue'
import StudentProfileField from './StudentProfileField.vue'
import { formatBirthDate, profileAge, profileFullName, profileFieldLabels, validateStudentProfile } from '../../student-profile-validation.ts'
import { studentProfileDraft, studentProfileSavePayload } from './student-profile-draft.js'
import { educationText } from '../../student-education.ts'
import './student-profile.css'
import { telegramInputValue, updateContactInput } from './contact-input.js'

const props = defineProps({ client: { type: Object, required: true }, englishLevels: { type: Array, default: () => [] }, save: { type: Function, required: true } })
const emit = defineEmits(['saved', 'editor-state', 'focus-workplaces'])
const workPlaces = defineModel('workPlaces', { type: Array, default: () => [] })
const editing = ref(false), submitted = ref(false), saving = ref(false), failure = ref(''), success = ref(''), formElement = ref(null)
const draft = ref(studentProfileDraft(props.client))
const levels = computed(() => props.englishLevels.filter(level => /\b[ABC][12]\b/i.test(level.label)))
const options = computed(() => ({ englishLevelIds: levels.value.map(level => Number(level.id)) }))
const validation = computed(() => validateStudentProfile({ ...draft.value, workPlaces: workPlaces.value }, options.value))
const savedValidation = computed(() => validateStudentProfile(studentProfileDraft(props.client), options.value))
const errors = computed(() => submitted.value ? validation.value.errors : {})
watchEffect(() => emit('editor-state', { editing: editing.value, saving: saving.value, error: errors.value.workPlaces || '' }))
const errorNames = computed(() => Object.keys(errors.value).map(key => profileFieldLabels[key]))
const autoName = computed(() => profileFullName(draft.value))
const autoAge = computed(() => profileAge(draft.value.birthDate))
const blankEducation = () => ({ uni: '', faculty: '', grade: '', yearOfEnd: '' })
const educationLabels = { uni: 'Университет', faculty: 'Факультет', grade: 'Квалификация', yearOfEnd: 'Год окончания' }
const otherEducationLabels = { uni: 'Название учебного заведения', yearOfEnd: 'Год окончания', city: 'Город' }
let educationDrafts = {}
watch(() => props.client, client => { if (!editing.value) draft.value = studentProfileDraft(client) })
function openEditor() { draft.value = studentProfileDraft(props.client); educationDrafts = {}; workPlaces.value = draft.value.workPlaces; submitted.value = false; failure.value = ''; success.value = ''; editing.value = true }
function cancel() { editing.value = false; failure.value = ''; submitted.value = false }
function setNoEducation() {
  const mode = draft.value.noHigherEducation
  educationDrafts[String(!mode)] = draft.value.educationEntries.map(row => ({ ...row }))
  draft.value.educationEntries = educationDrafts[String(mode)] || [{ ...blankEducation(), ...(mode ? { city: '' } : {}) }]
}
function removeEducation(index) {
  if (draft.value.educationEntries.length === 1) draft.value.educationEntries = [blankEducation()]
  else draft.value.educationEntries.splice(index, 1)
}
async function submit() {
  if (saving.value) return
  submitted.value = true; failure.value = ''; success.value = ''
  if (!validation.value.valid) {
    await nextTick()
    const first = formElement.value?.querySelector('.invalid')
    first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    first?.querySelector('input,select,button')?.focus({ preventScroll: true })
    if (!first && errors.value.workPlaces) emit('focus-workplaces')
    return
  }
  saving.value = true
  try {
    const result = await props.save(studentProfileSavePayload(validation.value.value))
    editing.value = false
    emit('saved', result)
    success.value = 'Профиль сохранён'
  } catch (error) { failure.value = error?.message || 'Не удалось сохранить профиль. Попробуйте ещё раз.' }
  finally { saving.value = false }
}
const viewFields = computed(() => [
  ['firstName', 'Имя', props.client.firstName], ['lastName', 'Фамилия', props.client.lastName],
  ['middleName', 'Отчество', props.client.middleName, true], ['fio', 'ФИО полностью', profileFullName(props.client)],
  ['birthDate', 'Дата рождения', formatBirthDate(props.client.birthDate)], ['realAge', 'Возраст', profileAge(props.client.birthDate)],
  ['englishLevelId', 'Уровень английского', levels.value.find(l => Number(l.id) === Number(props.client.englishLevelId))?.label],
  ['readyForInterviewInEnglishIn2Months', 'Готовность к собеседованию на английском через 2 месяца', props.client.readyForInterviewInEnglishIn2Months === 'Yes' ? 'Да' : props.client.readyForInterviewInEnglishIn2Months === 'No' ? 'Нет' : ''],
  ['realLocation', 'Реальная локация', props.client.realLocation], ['desiredLocation', 'Желаемая локация', props.client.desiredLocation],
  ['calendarEmail', 'Личный email (Gmail)', props.client.calendarEmail], ['telegramPersonalChatId', 'Личный Telegram @username', props.client.telegramPersonalChatId]
])
</script>

<template>
  <section class="student-profile" data-testid="validated-student-profile">
    <div v-if="!savedValidation.valid && !editing" class="student-incomplete" role="status">
      <span>Заполните обязательные поля профиля, чтобы мы могли продолжить работу</span>
      <button type="button" class="student-button" @click="openEditor">Заполнить</button>
    </div>
    <header class="student-profile-heading">
      <h3>{{ editing ? 'Редактировать данные' : 'Личные данные' }}</h3>
      <button v-if="!editing" type="button" class="student-button" data-testid="open-profile-editor-button" @click="openEditor">Редактировать данные</button>
    </header>
    <p v-if="success" class="student-success" role="status">{{ success }}</p>
    <form v-if="editing" id="student-profile-form" ref="formElement" class="student-form" novalidate data-testid="profile-form" @submit.prevent="submit">
      <p class="student-legend"><span class="required-star">*</span> — обязательное поле. Профиль нельзя сохранить, пока обязательные поля не заполнены</p>
      <div v-if="errorNames.length" class="student-error-summary" role="alert" data-testid="profile-validation-summary">Профиль не сохранён. Исправьте поля ({{ errorNames.length }}): {{ errorNames.join(', ') }}.</div>
      <div v-if="failure" class="student-error-summary" role="alert">{{ failure }}</div>
      <fieldset :disabled="saving" class="student-form-body">
        <div class="student-grid student-name-grid">
          <StudentProfileField v-for="[name, label] in [['firstName','Имя'],['lastName','Фамилия'],['middleName','Отчество (если есть)']]" :key="name" :name="name" :label="label" :required="name !== 'middleName'" :error="errors[name]" v-slot="field">
            <input :id="field.id" v-model="draft[name]" :aria-invalid="field.invalid" :aria-describedby="field.describedby" :aria-required="name !== 'middleName'" :placeholder="name === 'middleName' ? 'Необязательно' : ''" :data-testid="`profile-${name}`" />
          </StudentProfileField>
        </div>
        <div class="student-grid student-details-grid">
          <StudentProfileField class="student-wide" name="fio" label="ФИО полностью" automatic hint="Заполняется автоматически: Фамилия + Имя + Отчество" v-slot="field">
            <input :id="field.id" :value="autoName" readonly :aria-describedby="field.describedby" data-testid="profile-fio" />
          </StudentProfileField>
          <StudentProfileField name="birthDate" label="Дата рождения" required :error="errors.birthDate" v-slot="field">
            <input :id="field.id" v-model="draft.birthDate" inputmode="numeric" placeholder="ДД.ММ.ГГГГ" :aria-invalid="field.invalid" :aria-describedby="field.describedby" aria-required="true" data-testid="profile-birth-date" />
          </StudentProfileField>
          <StudentProfileField name="realAge" label="Возраст" hint="Рассчитывается автоматически по дате рождения" v-slot="field">
            <input :id="field.id" :value="autoAge ?? ''" readonly :aria-describedby="field.describedby" data-testid="profile-real-age" />
          </StudentProfileField>
          <StudentProfileField name="englishLevelId" label="Уровень английского" required :error="errors.englishLevelId" v-slot="field">
            <select :id="field.id" v-model="draft.englishLevelId" :aria-invalid="field.invalid" :aria-describedby="field.describedby" aria-required="true" data-testid="profile-english-level"><option value="" disabled>Выберите уровень</option><option v-for="level in levels" :key="level.id" :value="String(level.id)">{{ level.label }}</option></select>
          </StudentProfileField>
          <StudentProfileField name="readyForInterviewInEnglishIn2Months" label="Готовность к собеседованию на английском через 2 месяца" required :error="errors.readyForInterviewInEnglishIn2Months" v-slot="field">
            <select :id="field.id" v-model="draft.readyForInterviewInEnglishIn2Months" :aria-invalid="field.invalid" :aria-describedby="field.describedby" aria-required="true" data-testid="profile-ready-for-interview-in-english-in-2-months"><option value="" disabled>Выберите вариант</option><option value="Yes">Да</option><option value="No">Нет</option></select>
          </StudentProfileField>
        </div>
        <section class="student-section" :class="{ invalid: errors.educationEntries }" data-profile-field="educationEntries">
          <h4>Образование<span class="required-star"> *</span></h4>
          <template v-if="!draft.noHigherEducation">
          <div v-for="(entry, index) in draft.educationEntries" :key="index" class="student-education-row">
            <input v-for="(label, name) in educationLabels" :key="name" v-model="entry[name]" :aria-label="`${label}, образование ${index + 1}`" :placeholder="label" :disabled="draft.noHigherEducation" :aria-invalid="submitted && Boolean(validation.educationErrors[`${index}.${name}`])" :class="{ 'input-invalid': submitted && validation.educationErrors[`${index}.${name}`] }" :inputmode="name === 'yearOfEnd' ? 'numeric' : undefined" :data-testid="`profile-education-${name}-${index}`" />
            <button type="button" class="student-icon-button" :disabled="draft.noHigherEducation" :aria-label="`Удалить образование ${index + 1}`" @click="removeEducation(index)">×</button>
          </div>
          <button type="button" class="student-button" :disabled="draft.noHigherEducation || draft.educationEntries.length >= 5" data-testid="add-education-button" @click="draft.educationEntries.push(blankEducation())">+ Добавить образование</button>
          </template>
          <label class="student-checkbox student-no-education"><input v-model="draft.noHigherEducation" type="checkbox" data-testid="no-higher-education" @change="setNoEducation" />Нет высшего образования</label>
          <div v-if="draft.noHigherEducation" class="student-other-education" data-testid="other-education">
            <h4>Другое образование</h4>
            <div class="student-grid">
              <StudentProfileField v-for="(label, name) in otherEducationLabels" :key="name" :name="`other-education-${name}`" :label="label" required :error="submitted && validation.educationErrors[`0.${name}`] ? 'Заполните поле корректно' : ''" v-slot="field">
                <input :id="field.id" v-model="draft.educationEntries[0][name]" :aria-invalid="field.invalid" :aria-describedby="field.describedby" aria-required="true" :inputmode="name === 'yearOfEnd' ? 'numeric' : undefined" :data-testid="`profile-other-education-${name}`" />
              </StudentProfileField>
            </div>
          </div>
          <small v-if="errors.educationEntries" class="student-error">{{ errors.educationEntries }}</small>
        </section>
        <div class="student-grid student-section">
          <StudentProfileField name="realLocation" label="Реальная локация" required :error="errors.realLocation" hint="Формат: City, Country — на английском. Например: Tbilisi, Georgia" v-slot="field">
            <input :id="field.id" v-model="draft.realLocation" placeholder="Tbilisi, Georgia" :aria-invalid="field.invalid" :aria-describedby="field.describedby" aria-required="true" data-testid="profile-real-location" />
          </StudentProfileField>
          <StudentProfileField name="desiredLocation" label="Желаемая локация" required :error="errors.desiredLocation" hint="Формат: City, Country — на английском. Укажите Remote, если рассматриваете исключительно удалённую работу, используй &quot;; &quot; как разделитель" v-slot="field">
            <input :id="field.id" v-model="draft.desiredLocation" placeholder="City, Country или Remote" :aria-invalid="field.invalid" :aria-describedby="field.describedby" aria-required="true" data-testid="profile-desired-location" />
            <button type="button" class="student-chip" @click="draft.desiredLocation = 'Remote'">Remote</button>
          </StudentProfileField>
        </div>

        <div class="student-grid student-section">
          <StudentProfileField name="calendarEmail" label="Личный email (Gmail)" required :error="errors.calendarEmail" v-slot="field">
            <input :id="field.id" v-model="draft.calendarEmail" type="email" placeholder="name@gmail.com" :aria-invalid="field.invalid" :aria-describedby="field.describedby" aria-required="true" data-testid="profile-calendar-email" />
          </StudentProfileField>
          <StudentProfileField name="telegramPersonalChatId" label="Личный Telegram @username" required :error="errors.telegramPersonalChatId" v-slot="field">
            <input :id="field.id" :value="telegramInputValue(draft.telegramPersonalChatId)" autocapitalize="none" :spellcheck="false" :aria-invalid="field.invalid" :aria-describedby="field.describedby" aria-required="true" data-testid="profile-telegram" @input="draft.telegramPersonalChatId = updateContactInput($event, telegramInputValue)" />
          </StudentProfileField>
        </div>
        <div class="student-form-actions"><button type="button" class="student-button" @click="cancel">Отмена</button><button type="submit" class="student-button primary" data-testid="save-profile-button">{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button></div>
      </fieldset>
    </form>
    <template v-else>
      <dl class="student-read-grid">
        <div v-for="[key, label, value, optional] in viewFields" :key="key"><dt>{{ label }}</dt><dd :class="{ 'student-missing': !value && !optional }">{{ value || (optional ? '—' : 'не заполнено') }}</dd></div>
        <div class="student-wide"><dt>Образование</dt><dd v-if="client.noHigherEducation">Нет высшего образования</dd><dd v-if="savedValidation.errors.educationEntries" class="student-missing">не заполнено</dd><dd v-else v-for="(entry, index) in savedValidation.value.educationEntries" :key="index">{{ educationText([entry]) }}</dd></div>
      </dl>
      <slot />
    </template>
  </section>
</template>
