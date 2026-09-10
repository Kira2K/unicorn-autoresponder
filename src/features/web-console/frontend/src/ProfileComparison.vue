<script setup>
import { computed, nextTick } from 'vue'
import { comparisonGroups, fieldStatusLabel } from './profile-comparison-view.js'
import { profileSection } from './profile-workflow-view.js'
import ProfileValue from './ProfileValue.vue'
import ProfileSkillCard from './ProfileSkillCard.vue'
import ProfileEditableField from './ProfileEditableField.vue'
import ProfileIssues from './ProfileIssues.vue'
const props = defineProps({ preview: { type: Object, required: true }, result: { type: Object, default: null },
  editor: { type: Object, default: null }, disabled: Boolean })
const groups = computed(() => comparisonGroups(props.preview, props.result, props.editor))
async function select(group, event) {
  await props.editor.select(group.path, event.target.checked)
  await nextTick()
  event.target.checked = groups.value.find(item => item.path === group.path)?.enabled !== false
}
</script>
<template>
  <div class="profile-change-cards" data-testid="profile-comparison">
    <details v-for="group in groups" :key="group.section" class="profile-change-card" open :data-section="group.section">
      <summary class="profile-section-heading">
        <input v-if="editor && preview.document?.profile && Object.hasOwn(preview.document.profile, group.section)"
          type="checkbox" :aria-label="`Заполнять раздел: ${profileSection(group.section)}`" :checked="group.enabled"
          :disabled="disabled || !!editor.saving.value" @click.stop @change="select(group, $event)" />
        <strong>{{ profileSection(group.section) }}</strong>
        <span v-if="['experience', 'education'].includes(group.section)"> · Записей: {{ group.entries.length }}</span>
        <span class="profile-section-status" :data-status="group.status">{{ fieldStatusLabel(group.status) }}</span></summary>
      <ProfileIssues :issues="editor?.issues.value[group.path] || []" />
      <p v-if="['experience', 'education'].includes(group.section)" class="profile-muted">
        Добавлений: {{ group.counts.added }} · Изменений: {{ group.counts.changed }}
      </p>
      <ProfileIssues :issues="group.issues" />
      <p v-if="group.skipped.length" class="profile-muted">Записи с блокерами будут пропущены целиком. Остальные готовые изменения можно применить.</p>
      <ProfileSkillCard v-if="group.section === 'skills'" :steps="group.steps"
        :show-list="!preview.document?.profile?.skills?.add?.length" />
      <template v-for="entry in group.entries" :key="entry.id">
        <component :is="entry.record ? 'details' : 'section'" class="profile-change-entry" open>
          <summary v-if="entry.record" class="profile-change-heading"><i class="pi pi-chevron-right profile-record-chevron" />Запись {{ entry.record }}
            <span class="profile-section-status" :data-status="entry.status">{{ fieldStatusLabel(entry.status) }}</span>
            <span v-if="entry.action" class="profile-change-badge">{{ entry.action === 'create' ? 'Добавление' : 'Изменение' }}</span></summary>
          <div :class="group.section === 'skills' ? '' : 'profile-before-after'">
            <div v-if="group.section !== 'skills'"><h4>Сейчас</h4><ProfileValue :value="entry.before"
              :empty="entry.action === 'create' ? 'Новая запись' : 'Нет данных'" /></div>
            <div><h4>Будет</h4><ProfileEditableField v-for="field in entry.fields" :key="field.path"
              :field="field" :editor="editor" :disabled="disabled" />
              <ProfileValue v-if="!entry.fields.length" :value="entry.after" /></div>
          </div>
        </component>
      </template>
      <p v-if="!group.entries.length">Нет данных о полях в сохранённом Preview.</p>
    </details>
    <Message v-if="!groups.length" severity="info" :closable="false">Запланированных изменений нет.</Message>
  </div>
</template>
<style scoped>
.profile-section-heading { display: list-item; cursor: pointer; font-size: 1rem; }
.profile-section-heading input { width: 1rem; height: 1rem; margin-right: .5rem; accent-color: #059669; }
.profile-section-status { font-size: .8rem; margin-left: .5rem; color: #15803d; }
.profile-section-status[data-status="blocker"] { color: #dc2626; }
.profile-section-status[data-status="warning"] { color: #854d0e; }
.profile-section-status[data-status="excluded"] { color: #64748b; }
.profile-change-heading { cursor: pointer; }
details[open] > .profile-change-heading .profile-record-chevron { transform: rotate(90deg); }
.profile-record-chevron { font-size: .7rem; }
</style>
