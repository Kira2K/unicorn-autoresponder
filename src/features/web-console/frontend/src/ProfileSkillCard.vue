<script setup>
import { computed } from 'vue'
import { skillSummary } from './profile-preview-view.js'
const props = defineProps({ steps: { type: Array, default: () => [] } })
const skills = computed(() => skillSummary(props.steps))
</script>
<template>
  <div data-testid="profile-skills-summary">
    <p v-if="skills.existing !== null && skills.target !== null" class="profile-skill-equation">
      {{ skills.existing }} сохраняем + {{ skills.added.length }} добавляем = {{ skills.target }}
    </p><p v-else>Нет данных о полном количестве навыков.</p>
    <p class="profile-muted">Существующие навыки не удаляются. Проверка полного набора — не дополнительная отправка.</p>
    <details v-if="skills.added.length"><summary>Новые навыки · {{ skills.added.length }}</summary>
      <ul class="profile-skill-tags"><li v-for="skill in skills.added" :key="skill">{{ skill }}</li></ul>
    </details>
  </div>
</template>
