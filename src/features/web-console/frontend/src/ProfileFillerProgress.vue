<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { overallTime, stepTimer } from './profile-timers'

const props = defineProps({
  result: { type: Object, required: true },
  previewSteps: { type: Array, default: () => [] }
})

const names = computed(() => new Map(props.previewSteps.map(step => [step.id, step.summary])))
const steps = computed(() => {
  if (!props.previewSteps.length) return props.result.steps
  const saved = new Map(props.result.steps.map(step => [step.stepId, step]))
  return props.previewSteps.map(step => saved.get(step.id) || {
    stepId: step.id, section: step.section, status: 'pending', message: 'Waiting to start.'
  })
})
const complete = computed(() => steps.value.filter(step => step.status === 'verified').length)
const summary = computed(() => `${complete.value} of ${steps.value.length} completed`)
const failed = computed(() => steps.value.find(step => step.status === 'failed'))
const delayed = computed(() => steps.value.filter(step => step.status === 'verification_delayed'))
const now = ref(Date.now())
let timer
onMounted(() => { timer = window.setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => window.clearInterval(timer))

function label(step) {
  const labels = {
    pending: 'Waiting', waiting: 'Waiting before write', writing: 'Sending',
    write_accepted: 'Accepted by Unipile', verifying: 'Checking LinkedIn',
    verification_delayed: 'Accepted · verification delayed',
    verified: 'Completed', failed: 'Stopped'
  }
  return labels[step.status] || step.status
}

function failureText(kind, code) {
  if (code === 'unipile_api_invalid_parameters') {
    return 'Profile Filler sent parameters that do not match the Unipile API contract.'
  }
  if (kind === 'write_rejected') return 'Unipile rejected the write request.'
  if (kind === 'write_uncertain') return 'The write response was lost or timed out; the result is uncertain.'
  if (kind === 'write_accepted_not_visible') {
    return 'The write was accepted, but LinkedIn did not return it before the verification timeout.'
  }
  if (kind === 'value_mismatch') return 'LinkedIn returned a value different from the requested value.'
  return 'The step could not be verified.'
}
</script>

<template>
  <section class="profile-progress" data-testid="profile-progress">
    <header><strong>Progress</strong><span>{{ summary }}
      <small v-if="overallTime(result, now)" data-testid="profile-overall-timer">
        Elapsed {{ overallTime(result, now) }}</small>
    </span></header>
    <ol>
      <li v-for="step in steps" :key="step.stepId" :class="`profile-step-${step.status}`">
        <i :class="step.status === 'verified' ? 'pi pi-check-circle' :
          step.status === 'failed' ? 'pi pi-times-circle' :
            ['waiting', 'writing', 'write_accepted', 'verifying'].includes(step.status)
              ? 'pi pi-spin pi-spinner' : 'pi pi-circle'" />
        <div>
          <strong>{{ names.get(step.stepId) || step.section }}</strong>
          <small>{{ label(step) }}<template v-if="step.attempt"> · {{ step.attempt }}/{{ step.maxAttempts }}</template></small>
          <small>{{ step.message }}</small>
          <small v-if="stepTimer(step, result.status, now)" class="profile-step-timer">
            <i class="pi pi-clock" /> {{ stepTimer(step, result.status, now) }}</small>
        </div>
      </li>
    </ol>
    <Message v-if="failed" severity="error" :closable="false">
      {{ failureText(failed.failureKind, failed.errorCode) }}
      <template v-if="failed.errorCode"> Code: {{ failed.errorCode }}.</template>
      <template v-if="failed.errorCode === 'unipile_api_invalid_parameters'">
        The operation stopped before LinkedIn was changed. Contact the administrator before retrying.
      </template>
      <template v-else>Build a fresh preview to recheck what remains.</template>
    </Message>
    <Message v-else-if="delayed.length" severity="warn" :closable="false">
      {{ delayed.length }} change(s) were accepted but LinkedIn verification is delayed.
      Other steps continued. Build a fresh preview later to confirm them.
    </Message>
  </section>
</template>
