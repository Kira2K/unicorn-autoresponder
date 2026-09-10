<script setup>
import { computed, ref } from 'vue'
import { editableField, listFields, fieldChoices } from '../../../linkedin-automation/profile-filler/editable-fields.ts'
import { profileValue } from './profile-value-view.js'
import { issueMessage } from './profile-issue-view.js'
import { fieldDisplayStatus } from './profile-field-status.js'
import ProfileDateField from './ProfileDateField.vue'
const props = defineProps({ field: { type: Object, required: true }, editor: { type: Object, default: null }, disabled: Boolean })
const editing = ref(false)
const changed = computed(() => props.editor && Object.hasOwn(props.editor.values.value, props.field.path))
const pending = computed(() => props.editor?.saving.value === props.field.path)
const errors = computed(() => props.editor?.issues.value[props.field.path] || [])
const raw = computed(() => changed.value ? props.editor.values.value[props.field.path] : props.field.raw)
const isList = computed(() => listFields.has(props.field.inputKey))
const text = computed(() => isList.value ? (raw.value || []).map(item => item?.name || item).join('\n') : raw.value ?? '')
const multiline = computed(() => isList.value || ['description', 'about', 'activities'].includes(props.field.inputKey))
const choices = computed(() => props.field.section === 'open_to_work' && props.field.inputKey === 'start_date'
  ? ['IMMEDIATELY', 'FLEXIBLE'] : fieldChoices[props.field.inputKey])
const status = computed(() => fieldDisplayStatus(props.field, props.editor))
const date = computed(() => ['experience', 'education'].includes(props.field.section) &&
  ['start_date', 'end_date'].includes(props.field.inputKey))
function input(value) {
  props.editor.change(props.field.path, isList.value ? value.split('\n').map(item => item.trim()).filter(Boolean) : value)
}
async function save() {
  await props.editor?.save(props.field.path)
  if (!errors.value.length) editing.value = false
}
</script>
<template>
  <div class="profile-inline-field" :data-field-path="field.path" :data-status="status">
    <div class="profile-inline-label">
      <strong>{{ field.label }}</strong>
      <span :class="`field-status-${status}`">{{ pending ? 'Проверяем…' : changed && field.enabled !== false && !errors.length ? 'Не проверено' :
        { ready: 'Готово', warning: 'Есть замечания', blocker: 'Блокер', excluded: 'Не заполнять' }[status] }}</span>
      <button v-if="editor && editableField(field.path)" type="button" :aria-label="`Изменить: ${field.label}`" class="profile-edit-pencil"
        :disabled="disabled || field.enabled === false" @click="editing = !editing"><i class="pi pi-pencil" /></button>
    </div>
    <template v-if="editing && editor && field.enabled !== false">
      <ProfileDateField v-if="date" :model-value="raw" :label="field.label" :allow-current="field.inputKey === 'end_date'"
        :disabled="disabled" @update:model-value="input" @save="save" />
      <select v-else-if="choices && !isList" :aria-label="field.label" :value="text" :disabled="disabled"
        @change="input($event.target.value); save()"><option value="">Не указано</option>
        <option v-for="choice in choices" :key="choice" :value="choice">{{ profileValue(choice) }}</option></select>
      <textarea v-else-if="multiline" :aria-label="field.label" :value="text" :disabled="disabled" rows="5"
        @input="input($event.target.value)" @blur="save" />
      <input v-else :aria-label="field.label" :value="text" :disabled="disabled"
        @input="input($event.target.value)" @blur="save" @keydown.enter.prevent="$event.target.blur()" />
      <small v-if="isList">По одному значению в строке.</small>
    </template>
    <p v-else>{{ changed ? (isList ? text.replaceAll('\n', ', ') : text) : field.value }}</p>
    <small v-for="(issue, index) in errors" :key="index" class="field-status-blocker">{{ issueMessage(issue) }}</small>
    <template v-if="!changed"><small v-for="comment in field.comments" :key="comment">{{ comment }}</small></template>
    <details v-if="!changed && field.issues?.length"><summary>Подробности замечания</summary>
      <div v-for="(issue, index) in field.issues" :key="index"><p>{{ issue.message }}</p>
        <p v-if="issue.resolution">{{ issue.resolution }}</p>
        <p v-if="issue.suggestions?.length">{{ issue.suggestions.join(', ') }}</p>
        <code v-if="issue.suggestion">{{ issue.suggestion }}</code><code>{{ issue.path }}</code>
      </div></details>
    <small v-if="field.manuallyEdited">Исправлено вручную.</small>
    <small v-if="changed && field.enabled === false">Правка осталась в редакторе. Отключённый раздел не будет заполнен.</small>
    <button v-if="changed && !pending" type="button" @mousedown.prevent @click="editor.discard(field.path); editing = false">Отменить правку</button>
  </div>
</template>
<style scoped>
.profile-inline-field { margin-bottom: .85rem; overflow-wrap: anywhere; }
.profile-inline-label { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; font-size: .8rem; }
.profile-inline-label strong { color: #64748b; font-weight: 400; }
.profile-inline-field p { white-space: pre-wrap; margin: .3rem 0; }
.profile-inline-field small { display: block; font-size: .75rem; margin-top: .25rem; }
.profile-edit-pencil { border: 0; background: transparent; cursor: pointer; padding: .3rem; color: #2563eb; }
.field-status-ready { color: #15803d; } .field-status-warning { color: #854d0e; } .field-status-blocker { color: #dc2626; }
.field-status-excluded { color: #64748b; }
input, textarea, select { width: 100%; box-sizing: border-box; border: 1px solid #94a3b8; border-radius: .3rem; padding: .5rem; margin-top: .4rem; font: inherit; }
textarea { resize: vertical; } :focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
</style>
