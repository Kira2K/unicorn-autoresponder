<script setup>
import { failedRunAction, formatDate } from './linkedin-auth-view'

const props = defineProps({
  runs: { type: Array, default: () => [] },
  accounts: { type: Array, default: () => [] },
  busy: Boolean
})
const emit = defineEmits(['action'])
const actionLabel = { check: 'Check', connect: 'Connect', force_reauth: 'Refresh session' }
const statusLabel = {
  succeeded: 'Completed', failed: 'Failed', interrupted: 'Interrupted', running: 'Running'
}
const accountFor = run => props.accounts.find(account =>
  Number(account.platformAccountId) === Number(run.platformAccountId))
const retry = run => failedRunAction(run, accountFor(run))
</script>

<template>
  <section class="linkedin-history" data-testid="linkedin-history">
    <h3>Recent runs</h3>
    <div class="linkedin-table-wrap">
      <table class="linkedin-table linkedin-history-table">
        <thead><tr><th>Started</th><th>Student</th><th>Action</th><th>Status</th><th>Error</th><th>Retry</th></tr></thead>
        <tbody>
          <tr v-for="run in runs.slice(0, 20)" :key="run.runId"
            :data-testid="`linkedin-history-run-${run.runId}`">
            <td>{{ formatDate(run.startedAt) }}</td>
            <td>{{ run.clientName }}<small>#{{ run.platformAccountId }}</small></td>
            <td>{{ actionLabel[run.action] || run.action }}</td>
            <td><span :class="`linkedin-history-status linkedin-history-${run.status}`">{{ statusLabel[run.status] || run.status }}</span></td>
            <td><code v-if="run.errorCode">{{ run.errorCode }}</code><span v-else>—</span></td>
            <td><Button v-if="retry(run)" :label="retry(run).label" size="small" outlined
              :disabled="busy" :data-testid="`linkedin-history-retry-${run.runId}`"
              @click="emit('action', run, retry(run).action)" /></td>
          </tr>
          <tr v-if="!runs.length"><td colspan="6">No saved runs yet.</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
