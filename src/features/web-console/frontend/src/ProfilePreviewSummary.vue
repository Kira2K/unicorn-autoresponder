<script setup>
import { computed } from 'vue'
import { previewSummary } from './profile-preview-view.js'
const props = defineProps({ preview: { type: Object, default: null } })
const summary = computed(() => previewSummary(props.preview))
</script>
<template>
  <div class="profile-summary" data-testid="profile-preview-summary">
    <div v-for="section in ['experience', 'education']" :key="section">
      <span>{{ section === 'experience' ? 'Работы в документе' : 'Образование в документе' }}</span>
      <strong>{{ summary[section].total ?? 'Нет данных' }}</strong>
      <small>Добавить: {{ summary[section].created }} · Изменить: {{ summary[section].updated }}</small>
    </div>
    <div><span>Навыки</span><strong>{{ summary.skills.target ?? 'Нет данных' }}</strong>
      <small v-if="summary.skills.existing !== null">
        {{ summary.skills.existing }} сохраняем + {{ summary.skills.added.length }} добавляем
      </small><small v-else>Нет расчёта в сохранённом задании</small>
    </div>
  </div>
</template>
