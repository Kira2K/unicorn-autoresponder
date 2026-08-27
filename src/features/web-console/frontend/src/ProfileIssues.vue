<script setup>
defineProps({ issues: { type: Array, default: () => [] } })
const severity = issue => issue.level === 'fatal' ? 'error' : issue.autoFixed ? 'info' : 'warn'
</script>

<template>
  <div v-if="issues.length" class="profile-issues" data-testid="profile-analysis-issues">
    <Message v-for="issue in issues" :key="`${issue.path}-${issue.message}`"
      :severity="severity(issue)" :closable="false">
      <strong>{{ issue.path }}</strong>: {{ issue.message }}
      <small v-if="issue.resolution">{{ issue.resolution }}</small>
      <code v-if="issue.suggestion">{{ issue.suggestion }}</code>
    </Message>
  </div>
</template>
