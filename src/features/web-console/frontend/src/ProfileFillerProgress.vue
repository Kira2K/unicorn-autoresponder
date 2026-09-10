<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { overallTime, stepTimer } from './profile-timers'
import { progressGroups, progressSteps, stepLabels } from './profile-progress-view.js'
import { profileSection } from './profile-workflow-view.js'
const props = defineProps({
  result: { type: Object, required: true }, previewSteps: { type: Array, default: () => [] }
})
const groups = computed(() => progressGroups(props.result, props.previewSteps))
const steps = computed(() => progressSteps(props.result, props.previewSteps))
const complete = computed(() => groups.value.filter(group => group.confirmed).length)
const current = computed(() => steps.value.find(step =>
  ['writing', 'write_accepted', 'verifying', 'waiting', 'verification_delayed'].includes(step.status)))
const now = ref(Date.now())
const nextRead = computed(() => props.result.verification?.nextReadBackAt)
let timer
onMounted(() => { timer = window.setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => window.clearInterval(timer))
function readTimer() {
  return stepTimer({ status: 'verifying', nextActionAt: nextRead.value }, props.result.status, now.value)
}
</script>
<template>
  <section class="profile-progress" data-testid="profile-progress">
    <header><strong>Подтверждено разделов: {{ complete }} из {{ groups.length }}</strong>
      <small v-if="overallTime(result, now)" data-testid="profile-overall-timer">Прошло {{ overallTime(result, now) }}</small>
    </header>
    <progress :value="complete" :max="groups.length || 1" aria-label="Подтверждённые разделы" />
    <div v-if="current" class="profile-current-operation" aria-live="polite">
      <strong>{{ profileSection(current.section) }} · {{ stepLabels[current.status] }}</strong>
      <p v-if="nextRead" class="profile-step-timer">{{ readTimer() }}</p>
      <p v-else-if="stepTimer(current, result.status, now)" class="profile-step-timer">
        {{ stepTimer(current, result.status, now) }}</p>
      <p class="profile-muted">LinkedIn может возвращать изменения с задержкой. Принятый запрос ещё не означает подтверждение.</p>
    </div>
    <ol>
      <li v-for="group in groups" :key="group.section" :class="`profile-step-${group.status}`">
        <i :class="group.confirmed ? 'pi pi-check-circle' : group.status === 'failed' ? 'pi pi-exclamation-circle' : 'pi pi-clock'" />
        <div><strong>{{ group.name }}</strong><small>{{ group.label }}</small></div>
      </li>
    </ol>
    <details><summary>Технические операции · {{ steps.length }}</summary>
      <ol><li v-for="step in steps" :key="step.stepId">
        <div><strong>{{ profileSection(step.section) }} · {{ stepLabels[step.status] || 'Нет данных' }}</strong>
          <small>{{ step.message }}</small><code v-if="step.errorCode">{{ step.errorCode }}</code>
          <small v-if="step.attempt">Проверка {{ step.attempt }} / {{ step.maxAttempts ?? '—' }}</small>
        </div>
      </li></ol>
    </details>
  </section>
</template>
