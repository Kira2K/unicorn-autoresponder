<script setup>
import { computed, onMounted, watch } from 'vue'
import { connectionAudienceLabel, connectionCountdown, connectionEta, connectionProgressPercent,
  connectionQuotaLabel, connectionRunCanStart, connectionRunLabel } from './connection-inviter-view'

const props = defineProps({ account: Object, inviter: Object, disabled: Boolean })
const run = computed(() => props.inviter.runFor(props.account))
const stack = computed(() => props.inviter.stackFor(props.account))
const readiness = computed(() => props.inviter.readiness.value[props.account.platformAccountId])
const accountHistory = computed(() => props.inviter.history.value[props.account.platformAccountId] || [])
const pause = computed(() => props.inviter.pauses.value[props.account.platformAccountId])
const canStart = computed(() => connectionRunCanStart(run.value, Boolean(stack.value)) &&
  readiness.value?.writerEnabled !== false)
const timer = computed(() => props.inviter.countdownFor(run.value))
const recruiterSent = computed(() => Number(run.value?.counters?.sentByAudience?.recruiter || 0))
const technicalSent = computed(() => Number(run.value?.counters?.sentByAudience?.technical || 0))
const keysProcessed = computed(() => Number(run.value?.searchProgress?.keyIndex?.recruiter || 0) +
  Number(run.value?.searchProgress?.keyIndex?.technical || 0))
const keysTotal = computed(() => Number(run.value?.searchProgress?.keyTotal?.recruiter || 0) +
  Number(run.value?.searchProgress?.keyTotal?.technical || 0))
const reasons = computed(() => Object.entries(run.value?.skipReasonCounters || {})
  .sort((left, right) => right[1] - left[1]).slice(0, 4))
const severity = computed(() => run.value?.status === 'failed' ? 'danger' :
  ['partial', 'paused', 'uncertain'].includes(run.value?.status) ||
    run.value?.stage === 'waiting_retry' ? 'warn' :
    run.value?.status === 'succeeded' ? 'success' : run.value?.status === 'running' ? 'info' : 'secondary')

watch(() => run.value?.runId, () => {
  props.inviter.ensure(props.account)
})
onMounted(() => props.inviter.ensure(props.account))
</script>

<template>
  <div class="connection-inviter" :data-testid="`connection-inviter-${account.platformAccountId}`">
    <div class="connection-inviter-head">
      <Tag :severity="pause ? 'warn' : severity" :value="pause ? 'Paused' : connectionRunLabel(run)" />
      <Button v-if="stack && run?.status !== 'running'" label="Run today" size="small" severity="success"
        :loading="inviter.loading.value[account.platformAccountId]" :disabled="!canStart"
        :data-testid="`connection-run-${account.platformAccountId}`" @click="inviter.start(account)" />
      <Button v-if="run?.status === 'running'" label="Stop" size="small" severity="danger" outlined
        :loading="inviter.loading.value[account.platformAccountId]"
        :data-testid="`connection-stop-${account.platformAccountId}`" @click="inviter.stop(account)" />
    </div>
    <small>Readiness: {{ readiness?.ready ? 'ready' : stack ? 'checking' : 'stack required' }}</small>
    <small v-if="readiness?.writerEnabled === false" class="comment-monitor-warning">Read-only backend</small>
    <small>Stack: {{ stack || 'missing' }}</small>
    <small v-if="!run">Connections and quota are checked when the run starts</small>
    <small v-else>Stage: {{ run.stage.replaceAll('_', ' ') }}</small>
    <small v-if="run">{{ connectionQuotaLabel(run) }}</small>
    <small v-if="run">{{ connectionAudienceLabel(run) }}</small>

    <div v-if="run?.dailyQuota" class="connection-progress-grid">
      <label>Overall {{ run.counters?.sent || 0 }} / {{ run.dailyQuota }}</label>
      <progress :value="connectionProgressPercent(run.counters?.sent, run.dailyQuota)" max="100" />
      <label>Recruiters {{ recruiterSent }} / {{ run.audienceQuota?.recruiter || 0 }}</label>
      <progress :value="connectionProgressPercent(recruiterSent, run.audienceQuota?.recruiter)" max="100" />
      <label>Technical {{ technicalSent }} / {{ run.audienceQuota?.technical || 0 }}</label>
      <progress :value="connectionProgressPercent(technicalSent, run.audienceQuota?.technical)" max="100" />
    </div>

    <small v-if="run?.searchProgress">
      Search keys {{ keysProcessed }} / {{ keysTotal }} · {{ run.searchProgress.audience || '—' }} ·
      {{ run.searchProgress.city || '—' }} · page {{ run.searchProgress.page || 0 }}
    </small>
    <small v-if="run?.searchProgress">
      Found {{ run.searchProgress.found }} · Checked {{ run.searchProgress.checked }} ·
      Eligible {{ run.searchProgress.eligible }} · Skipped {{ run.searchProgress.skipped }}
    </small>
    <small v-if="reasons.length">Top skips: {{ reasons.map(([code, count]) => `${code} ${count}`).join(' · ') }}</small>
    <small v-if="run">Seven days: {{ readiness?.sevenDaySent || 0 }} sent · {{ connectionEta(run) }}</small>

    <div v-if="timer" class="connection-timer">
      <strong>{{ run?.timerState?.kind?.replaceAll('_', ' ') || 'waiting' }}</strong>
      <span>{{ connectionCountdown(timer) }}</span>
      <small v-if="run?.retryState">
        {{ run.retryState.provider }} · {{ run.retryState.errorCode }} · attempt {{ run.retryState.attempt }} ·
        retry {{ new Date(run.retryState.nextRetryAt).toLocaleTimeString() }}
      </small>
    </div>

    <div v-if="!stack" class="connection-stack-editor">
      <Select v-model="inviter.stackDrafts.value[account.platformAccountId]" :options="inviter.stacks.value"
        option-label="name" option-value="id" placeholder="Select stack"
        :data-testid="`connection-stack-${account.platformAccountId}`" />
      <Button label="Save and run" size="small"
        :disabled="!inviter.stackDrafts.value[account.platformAccountId]"
        :data-testid="`connection-stack-save-${account.platformAccountId}`" @click="inviter.saveStack(account)" />
      <Button label="Recruiters only" size="small" severity="secondary" outlined
        :disabled="!canStart" :data-testid="`connection-safe-run-${account.platformAccountId}`"
        @click="inviter.start(account, true)" />
    </div>
    <small v-if="run?.errorCode" class="comment-monitor-error">{{ run.errorCode }}</small>
    <small v-if="pause" class="comment-monitor-warning">{{ pause.message }}</small>
    <small v-if="inviter.errors.value[account.platformAccountId]" class="comment-monitor-error">
      {{ inviter.errors.value[account.platformAccountId] }}
    </small>
    <details v-if="accountHistory.length" class="comment-monitor-history">
      <summary>Connection history</summary>
      <div v-for="item in accountHistory.slice(0, 5)" :key="item.personId">
        <strong>{{ item.status }}</strong>: {{ item.name }} · {{ item.audience }} · {{ item.reasonCode || 'no reason' }}
      </div>
    </details>
  </div>
</template>
