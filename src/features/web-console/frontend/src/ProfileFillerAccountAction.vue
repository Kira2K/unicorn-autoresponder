<script setup>
import { computed } from 'vue'
import { isProfileActive, profileStatus } from './profile-workflow-view.js'
const props = defineProps({ filler: { type: Object, required: true }, account: { type: Object, required: true }, blocked: Boolean })
const tracked = computed(() => props.filler.trackedJob.value?.platformAccountId === props.account.platformAccountId
  ? props.filler.trackedJob.value : null)
const label = computed(() => isProfileActive(tracked.value) ? 'Открыть прогресс'
  : tracked.value ? 'Открыть результат' : 'Заполнить профиль')
const disabled = computed(() => props.blocked || props.filler.pending.value || props.filler.loading.value ||
  (props.filler.active.value && !tracked.value))
</script>
<template>
  <small v-if="tracked" class="profile-account-status" role="status">{{ profileStatus(tracked) }}</small>
  <Button :label="label" size="small" severity="help" outlined :disabled="disabled"
    :data-testid="`profile-filler-${account.platformAccountId}`" @click="filler.open(account)" />
</template>
