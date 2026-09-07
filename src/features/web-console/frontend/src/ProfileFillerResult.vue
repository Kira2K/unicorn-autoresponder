<script setup>
import { computed } from 'vue'
import { profileStatus } from './profile-workflow-view.js'
import { progressGroups } from './profile-progress-view.js'
import { omittedSkills } from './profile-preview-view.js'
import { issueMessage } from './profile-issue-view.js'
import { generationErrorText } from './profile-generation-view.js'
import { overallTime } from './profile-timers'
const props = defineProps({ job: { type: Object, required: true } })
const partial = computed(() => props.job.phase === 'partially_completed')
const success = computed(() => props.job.status === 'succeeded' && !partial.value)
const groups = computed(() => progressGroups(props.job.result, props.job.preview?.steps))
const missing = computed(() => omittedSkills(props.job.preview?.issues))
const elapsed = computed(() => props.job.result && overallTime(props.job.result,
  Date.parse(props.job.finishedAt || props.job.updatedAt)))
</script>
<template>
  <section class="profile-result" data-testid="profile-result" aria-live="polite">
    <Message :severity="success ? 'success' : partial ? 'warn' : 'error'" :closable="false">
      <strong :data-testid="partial ? 'profile-partially-completed' : 'profile-result-title'">
        {{ profileStatus(job) }}
      </strong>
      <p v-if="success">Все запланированные изменения подтверждены чтением LinkedIn.</p>
      <p v-else-if="partial">Остальные изменения подтверждены. Существующие навыки не удалялись.</p>
      <p v-else>Не все изменения подтверждены. Повторная отправка автоматически не выполняется.</p>
    </Message>
    <p v-if="elapsed" class="profile-muted" data-testid="profile-overall-timer">Длительность: {{ elapsed }}</p>
    <ul v-if="groups.length" class="profile-result-list">
      <li v-for="group in groups" :key="group.section">
        <i :class="group.confirmed ? 'pi pi-check-circle' : 'pi pi-exclamation-circle'" />
        <strong>{{ group.name }}</strong> — {{ group.confirmed ? 'Подтверждено' : group.label }}
      </li>
    </ul>
    <div v-if="missing.length"><h3>Не применённые навыки</h3>
      <ul><li v-for="(issue, index) in missing" :key="index">{{ issueMessage(issue) }}</li></ul>
    </div>
    <p v-if="job.errorCode">{{ generationErrorText(job.errorCode) || 'Нужна проверка специалиста; код указан в подробностях.' }}</p>
    <p v-if="!success && !partial">Проверьте указанные разделы. Новый Preview не означает повторное разрешение на запись.</p>
  </section>
</template>
