<script setup>
import { computed } from 'vue'
import { statusView } from './linkedin-auth-view'

const props = defineProps({ account: { type: Object, required: true }, run: { type: Object, default: null } })
const view = computed(() => statusView(props.account, props.run))
</script>

<template>
  <div class="linkedin-status" data-testid="linkedin-status">
    <span :class="['linkedin-status-pill', `linkedin-status-${view.tone}`]">{{ view.label }}</span>
    <small v-if="view.stage" data-testid="linkedin-current-stage">{{ view.stage }}</small>
    <template v-if="view.error">
      <strong>{{ view.error.message }}</strong>
      <small>{{ view.error.action }}</small>
      <code data-testid="linkedin-error-code">{{ view.error.code }}</code>
    </template>
  </div>
</template>
