<script setup>
import { formatDate } from './linkedin-auth-view'

defineProps({ runs: { type: Array, default: () => [] } })

const actionLabel = { check: 'Check', connect: 'Connect', force_reauth: 'Refresh session' }
const statusLabel = {
  succeeded: 'Completed', failed: 'Failed', interrupted: 'Interrupted', running: 'Running'
}
</script>

<template>
  <section class="linkedin-history" data-testid="linkedin-history">
    <h3>Recent runs</h3>
    <div class="linkedin-table-wrap">
      <table class="linkedin-table linkedin-history-table">
        <thead><tr><th>Started</th><th>Student</th><th>Action</th><th>Status</th><th>Error</th></tr></thead>
        <tbody>
          <tr v-for="run in runs.slice(0, 20)" :key="run.runId">
            <td>{{ formatDate(run.startedAt) }}</td>
            <td>{{ run.clientName }}<small>#{{ run.platformAccountId }}</small></td>
            <td>{{ actionLabel[run.action] || run.action }}</td>
            <td><span :class="`linkedin-history-status linkedin-history-${run.status}`">{{ statusLabel[run.status] || run.status }}</span></td>
            <td><code v-if="run.errorCode">{{ run.errorCode }}</code><span v-else>—</span></td>
          </tr>
          <tr v-if="!runs.length"><td colspan="5">No saved runs yet.</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
