<script setup>
defineProps({ steps: { type: Array, default: () => [] } })

function valueText(value) {
  if (value === null || value === undefined || value === '') return '—'
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}
</script>

<template>
  <div v-if="steps.length" class="profile-comparison">
    <strong>Field</strong><strong>Current value</strong><strong>New value</strong>
    <template v-for="step in steps" :key="step.id">
      <div><strong>{{ step.section }}</strong><small>{{ step.summary }}</small></div>
      <pre>{{ valueText(step.before) }}</pre>
      <pre>{{ valueText(step.after) }}</pre>
    </template>
  </div>
  <Message v-else severity="info" :closable="false">No changes found.</Message>
</template>
