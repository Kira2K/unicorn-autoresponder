<script setup>
import { computed } from 'vue'
import { profileStatus, preparationFailed } from './profile-workflow-view.js'
import { progressGroups } from './profile-progress-view.js'
import { omittedSkills } from './profile-preview-view.js'
import { issueMessage, issueTitle } from './profile-issue-view.js'
import { generationErrorText } from './profile-generation-view.js'
import { overallTime } from './profile-timers'
const props = defineProps({ job: { type: Object, required: true } })
const partial = computed(() => props.job.phase === 'partially_completed')
const stopped = computed(() => props.job.phase === 'generation_stopped')
const success = computed(() => props.job.status === 'succeeded' && !partial.value)
const groups = computed(() => progressGroups(props.job.result, props.job.preview?.steps))
const missing = computed(() => omittedSkills(props.job.preview?.issues))
const elapsed = computed(() => props.job.result && overallTime(props.job.result,
  Date.parse(props.job.finishedAt || props.job.updatedAt)))
</script>
<template>
  <section class="profile-result" data-testid="profile-result" aria-live="polite">
    <Message :severity="success ? 'success' : stopped ? 'info' : partial ? 'warn' : 'error'" :closable="false">
      <strong :data-testid="partial ? 'profile-partially-completed' : 'profile-result-title'">
        {{ profileStatus(job) }}
      </strong>
      <p v-if="stopped">Генерация остановлена. Это задание не изменяло LinkedIn. Можно подготовить новое Preview.</p>
      <p v-else-if="preparationFailed(job)">Сбой произошёл до заполнения LinkedIn. Изменения в профиль не отправлялись.</p>
      <p v-else-if="success">Все запланированные изменения подтверждены чтением LinkedIn.</p>
      <p v-else-if="partial">Готовые изменения подтверждены. Перечисленные ниже поля или записи не применялись.</p>
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
    <div v-if="job.preview?.skippedChanges?.length"><h3>Пропущенные изменения</h3>
      <ul><li v-for="path in job.preview.skippedChanges" :key="path">{{ issueTitle({ path }) }}</li></ul>
    </div>
    <details v-if="job.preview?.disabledFields?.length">
      <summary>Не заполнялись по вашему выбору: {{ job.preview.disabledFields.length }} полей</summary>
      <ul><li v-for="path in job.preview.disabledFields" :key="path">{{ issueTitle({ path }) }}</li></ul>
    </details>
    <p v-if="job.errorCode">{{ generationErrorText(job.errorCode) || 'Нужна проверка специалиста; код указан в подробностях.' }}</p>
    <p v-if="!success && !partial && !stopped && !preparationFailed(job)">Проверьте указанные разделы. Новый Preview не означает повторное разрешение на запись.</p>
  </section>
</template>
