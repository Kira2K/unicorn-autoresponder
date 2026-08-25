<script setup>
import { computed } from 'vue'
import { durationUntil, monitorActive, monitorError, monitorLabel } from './comment-monitor-view'

const props = defineProps({ account: Object, monitor: Object })
const job = computed(() => props.monitor.jobFor(props.account))
const state = computed(() => job.value?.state || {})
</script>

<template>
  <div class="comment-monitor" :data-testid="`comment-monitor-${account.platformAccountId}`">
    <div class="comment-monitor-head">
      <Tag :severity="job?.status === 'error' ? 'danger' : job?.status === 'paused' ? 'warn' :
        monitorActive(job) ? 'info' : job?.status === 'completed' ? 'success' : 'secondary'"
        :value="monitorLabel(job)" />
      <Button :label="monitorActive(job) ? 'Disable' : 'Enable'" size="small"
        :severity="monitorActive(job) ? 'secondary' : 'success'"
        :loading="monitor.loading.value[account.platformAccountId]"
        :data-testid="`comment-monitor-toggle-${account.platformAccountId}`"
        @click="monitor.toggle(account)" />
    </div>
    <small v-if="job">{{ String(job.stage || '').replaceAll('_', ' ') }}</small>
    <small v-if="job?.nextCheckAt">Next: {{ durationUntil(job.nextCheckAt, monitor.now.value) }}</small>
    <small v-if="job?.lastCheckAt">Last: {{ new Date(job.lastCheckAt).toLocaleString() }}</small>
    <small v-if="job?.expiresAt">Remaining: {{ durationUntil(job.expiresAt, monitor.now.value) }}</small>
    <small v-if="job">Checks {{ state.checks || 0 }} · Found {{ state.discovered || 0 }} ·
      Replied {{ state.published || 0 }} · Failed {{ state.failed || 0 }}</small>
    <div v-if="state.posts?.length" class="comment-monitor-posts">
      <a v-for="(post, index) in state.posts" :key="post.id" :href="post.url" target="_blank"
        rel="noreferrer">Post {{ index + 1 }}</a>
    </div>
    <small v-if="job?.errorCode" class="comment-monitor-error">{{ monitorError(job.errorCode) }}</small>
    <small v-if="monitor.errors.value[account.platformAccountId]" class="comment-monitor-error">
      {{ monitor.errors.value[account.platformAccountId] }}
    </small>
    <details v-if="state.items?.length" class="comment-monitor-history">
      <summary>Recent activity</summary>
      <div v-for="item in state.items.slice(-5).reverse()" :key="item.incomingId">
        <strong>{{ item.status }}</strong>: {{ item.incomingText }}
        <small v-if="item.replyText">Reply: {{ item.replyText }}</small>
        <small v-if="item.reasonCode">{{ item.reasonCode }}</small>
      </div>
    </details>
    <Button v-if="job?.status === 'paused'" label="Resume" size="small" severity="warn" outlined
      @click="monitor.resume(job)" />
  </div>
</template>
