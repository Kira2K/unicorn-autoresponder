<script setup>
import { computed, onMounted } from 'vue'
import { connectionAudienceLabel, connectionQuotaLabel, connectionRunLabel } from './connection-inviter-view'

const props = defineProps({ account: Object, inviter: Object, disabled: Boolean })
const run = computed(() => props.inviter.runFor(props.account))
const stack = computed(() => props.inviter.stackFor(props.account))
const readiness = computed(() => props.inviter.readiness.value[props.account.platformAccountId])
const accountHistory = computed(() => props.inviter.history.value[props.account.platformAccountId] || [])
onMounted(() => props.inviter.ensure(props.account))
</script>

<template>
  <div class="connection-inviter" :data-testid="`connection-inviter-${account.platformAccountId}`">
    <div class="connection-inviter-head">
      <Tag :severity="run?.status === 'succeeded' ? 'success' : run?.status === 'failed' ? 'danger' :
        run?.status === 'uncertain' || run?.status === 'paused' ? 'warn' : run?.status === 'running' ? 'info' : 'secondary'"
        :value="connectionRunLabel(run)" />
      <Button v-if="stack" label="Run today" size="small" severity="success"
        :loading="inviter.loading.value[account.platformAccountId]"
        :disabled="disabled || run?.status === 'running' || run?.status === 'succeeded'"
        :data-testid="`connection-run-${account.platformAccountId}`" @click="inviter.start(account)" />
    </div>
    <small>Readiness: {{ readiness?.ready ? 'ready' : stack ? 'checking' : 'stack required' }}</small>
    <small>Stack: {{ stack || 'missing' }}</small>
    <small v-if="!run">Connections and quota are checked when the run starts</small>
    <small v-if="run">{{ connectionQuotaLabel(run) }}</small>
    <small v-if="run">{{ connectionAudienceLabel(run) }}</small>
    <small v-if="run">Sent {{ run.counters?.sent || 0 }} · Skipped {{ run.counters?.skipped || 0 }}</small>
    <div v-if="!stack" class="connection-stack-editor">
      <Select v-model="inviter.stackDrafts.value[account.platformAccountId]"
        :options="inviter.stacks.value" option-label="name" option-value="id" placeholder="Select stack"
        :data-testid="`connection-stack-${account.platformAccountId}`" />
      <Button label="Save and run" size="small" :disabled="disabled || !inviter.stackDrafts.value[account.platformAccountId]"
        :data-testid="`connection-stack-save-${account.platformAccountId}`" @click="inviter.saveStack(account)" />
      <Button label="Recruiters only" size="small" severity="secondary" outlined :disabled="disabled"
        :data-testid="`connection-safe-run-${account.platformAccountId}`" @click="inviter.start(account, true)" />
    </div>
    <small v-if="run?.errorCode" class="comment-monitor-error">{{ run.errorCode }}</small>
    <small v-if="inviter.errors.value[account.platformAccountId]" class="comment-monitor-error">
      {{ inviter.errors.value[account.platformAccountId] }}
    </small>
    <details v-if="accountHistory.length" class="comment-monitor-history">
      <summary>Connection history</summary>
      <div v-for="item in accountHistory.slice(0, 5)" :key="item.personId">
        <strong>{{ item.status }}</strong>: {{ item.name }} · {{ item.audience }}
      </div>
    </details>
  </div>
</template>
