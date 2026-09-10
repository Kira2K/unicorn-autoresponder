<script setup>
import { profileStatus, profileDate } from './profile-workflow-view.js'
defineProps({ filler: { type: Object, required: true } })
</script>
<template>
  <details class="profile-filler-history" data-testid="profile-filler-history">
    <summary>История запусков · {{ filler.history.value.length }}</summary>
    <ul><li v-for="item in filler.history.value" :key="item.jobId">
      <button type="button" class="profile-history-button" :disabled="filler.pending.value"
        :aria-current="filler.job.value?.jobId === item.jobId ? 'true' : undefined"
        @click="filler.showHistory(item)">
        <strong>{{ profileStatus(item) }}</strong><small>{{ profileDate(item.updatedAt) }}</small>
      </button>
    </li><li v-if="!filler.history.value.length">Предыдущих запусков нет.</li></ul>
  </details>
</template>
