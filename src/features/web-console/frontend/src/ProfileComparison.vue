<script setup>
import { computed } from 'vue'
import { previewGroups } from './profile-preview-view.js'
import { profileSection } from './profile-workflow-view.js'
import ProfileValue from './ProfileValue.vue'
import ProfileSkillCard from './ProfileSkillCard.vue'
const props = defineProps({ preview: { type: Object, required: true } })
const groups = computed(() => previewGroups(props.preview))
</script>
<template>
  <div class="profile-change-cards" data-testid="profile-comparison">
    <article v-for="group in groups" :key="group.section" class="profile-change-card">
      <h3>{{ profileSection(group.section) }}</h3>
      <ProfileSkillCard v-if="group.section === 'skills'" :steps="group.steps" />
      <template v-else>
        <section v-for="(step, index) in group.steps" :key="step.id" class="profile-change-entry">
          <div class="profile-change-heading"><strong v-if="group.steps.length > 1">Запись {{ index + 1 }}</strong>
            <span class="profile-change-badge">{{ step.action === 'create' || step.action === 'add' ? 'Добавление' : 'Изменение' }}</span>
          </div>
          <div class="profile-before-after">
            <div><h4>Сейчас</h4><ProfileValue :value="step.before"
              :empty="step.action === 'create' ? 'Новая запись' : 'Нет данных'" /></div>
            <div><h4>Будет</h4><ProfileValue :value="step.after" /></div>
          </div>
        </section>
      </template>
      <details v-if="['experience', 'education'].includes(group.section)" class="profile-document-entries">
        <summary>Все записи подготовленного документа</summary>
        <article v-for="(entry, index) in preview.document?.profile?.[group.section] || []" :key="index">
          <h4>Запись {{ index + 1 }}</h4><ProfileValue :value="entry.data || entry" />
        </article>
        <p v-if="!preview.document?.profile?.[group.section]">Нет данных</p>
      </details>
      <p v-if="!group.steps.length">Нет запланированных изменений в этом разделе.</p>
    </article>
    <Message v-if="!groups.length" severity="info" :closable="false">Запланированных изменений нет.</Message>
  </div>
</template>
