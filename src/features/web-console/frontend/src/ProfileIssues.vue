<script setup>
import { computed } from 'vue'
import { issueTitle, issueMessage } from './profile-issue-view.js'
const props = defineProps({ issues: { type: Array, default: () => [] } })
const groups = computed(() => [
  { title: 'Нужно исправить перед применением', severity: 'error', items: props.issues.filter(i => i.level === 'fatal') },
  { title: 'Обратите внимание', severity: 'warn', items: props.issues.filter(i => i.level !== 'fatal' && !i.autoFixed) },
  { title: 'Исправлено автоматически', severity: 'info', items: props.issues.filter(i => i.level !== 'fatal' && i.autoFixed) }
].filter(group => group.items.length))
</script>
<template>
  <div v-if="groups.length" class="profile-issues" data-testid="profile-analysis-issues">
    <section v-for="group in groups" :key="group.title">
      <h3>{{ group.title }}</h3>
      <Message v-for="(issue, index) in group.items" :key="index" :severity="group.severity" :closable="false">
        <strong>{{ issueTitle(issue) }}</strong><p>{{ issueMessage(issue) }}</p>
        <details><summary>Подробности замечания</summary>
          <p>{{ issue.message }}</p><p v-if="issue.resolution">{{ issue.resolution }}</p>
          <code>{{ issue.path }}</code><code v-if="issue.suggestion">{{ issue.suggestion }}</code>
        </details>
      </Message>
    </section>
  </div>
</template>
