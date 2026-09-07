<script setup>
import { computed } from 'vue'
import ProfileFillerInput from './ProfileFillerInput.vue'
import ProfileFillerProgress from './ProfileFillerProgress.vue'
import ProfileFillerHistory from './ProfileFillerHistory.vue'
import ProfileFillerResult from './ProfileFillerResult.vue'
import ProfileFillerFooter from './ProfileFillerFooter.vue'
import ProfilePreviewSummary from './ProfilePreviewSummary.vue'
import ProfileComparison from './ProfileComparison.vue'
import ProfileIssues from './ProfileIssues.vue'
import ProfileManualEditor from './ProfileManualEditor.vue'
import { profileLink, profileStage, profileStatus } from './profile-workflow-view.js'
import { generationErrorText, profileStageText } from './profile-generation-view.js'
import { duration } from './profile-timers'
const props = defineProps({ filler: { type: Object, required: true } })
const stage = computed(() => profileStage(props.filler.job.value))
const link = computed(() => profileLink(props.filler.account.value, props.filler.job.value))
const stages = ['CV', 'Проверка изменений', 'Заполнение', 'Результат']
</script>
<template>
  <Dialog :visible="filler.visible.value" modal header="Заполнение LinkedIn"
    class="profile-filler-dialog" :close-on-escape="!filler.confirmation.value"
    @update:visible="v => !v && !filler.confirmation.value && filler.close()">
    <template #header><div class="profile-dialog-heading"><strong>Заполнение LinkedIn</strong>
      <span>{{ filler.account.value?.clientName }}<a v-if="link" :href="link" target="_blank" rel="noreferrer">
        Открыть LinkedIn <i class="pi pi-external-link" /></a></span>
    </div></template>
    <div class="profile-workspace">
      <aside class="profile-sidebar"><ol aria-label="Этапы заполнения">
        <li v-for="(name, index) in stages" :key="name" :class="{ current: stage === index }"
          :aria-current="stage === index ? 'step' : undefined"><span>{{ index + 1 }}</span>{{ name }}</li>
      </ol><p>Изменения в LinkedIn — только после вашего подтверждения.</p></aside>
      <main class="profile-main">
        <Message v-if="filler.error.value" severity="error" :closable="false" data-testid="profile-ui-error">{{ filler.error.value }}</Message>
        <p v-if="filler.loading.value" role="status">Загружаем историю ученика…</p>
        <template v-else>
          <Message v-if="filler.active.value && filler.job.value?.jobId !== filler.trackedJob.value?.jobId"
            severity="info" :closable="false">Вы просматриваете историю. Текущее задание продолжает работать.
            <Button label="Вернуться к прогрессу" text @click="filler.showHistory(filler.trackedJob.value)" />
          </Message>
          <ProfileFillerInput v-if="!filler.job.value" :filler="filler" />
          <div v-else class="profile-filler-content" data-testid="profile-filler-job">
            <template v-if="stage !== 3"><h2>{{ profileStatus(filler.job.value) }}</h2>
              <p v-if="stage === 1 && filler.active.value" role="status">{{ profileStageText(filler.job.value.phase) }}</p>
              <p v-if="filler.active.value" class="profile-muted">Прошло {{ duration(filler.elapsedSeconds.value * 1000) }}.
                Окно можно свернуть — работа продолжится.</p>
              <p v-if="filler.job.value.retry?.nextRetryAt" class="profile-step-timer">
                Следующая попытка через {{ duration(filler.retrySeconds.value * 1000) }}</p>
            </template>
            <ProfileFillerResult v-if="stage === 3" :job="filler.job.value" />
            <ProfileFillerProgress v-if="stage !== 3 && filler.job.value.result?.steps" :result="filler.job.value.result"
              :preview-steps="filler.job.value.preview?.steps" />
            <template v-if="filler.job.value.preview">
              <ProfilePreviewSummary v-if="stage === 1" :preview="filler.job.value.preview" />
              <ProfileIssues v-if="stage === 1" :issues="filler.job.value.preview.issues || []" />
              <p v-if="filler.job.value.preview.generation && stage === 1" class="profile-muted">
                Данные связаны с CV. Для исправления загрузите новое CV и подготовьте изменения заново.</p>
              <ProfileManualEditor v-if="stage === 1" :filler="filler" />
              <p v-if="filler.dirty.value" role="alert">Документ изменён. Пересоберите Preview перед применением.</p>
              <ProfileComparison v-if="stage === 1" :preview="filler.job.value.preview" />
              <details v-else><summary>Подтверждённый план изменений</summary>
                <ProfilePreviewSummary :preview="filler.job.value.preview" />
                <ProfileIssues :issues="filler.job.value.preview.issues || []" />
                <ProfileComparison :preview="filler.job.value.preview" /></details>
            </template>
            <p v-if="stage !== 3 && filler.job.value.errorCode">
              {{ generationErrorText(filler.job.value.errorCode) || 'Не удалось завершить операцию; подробности ниже.' }}</p>
            <details class="profile-advanced"><summary>Технические подробности задания</summary>
              <p>Задание: <code>{{ filler.job.value.jobId }}</code></p>
              <p>Статус: {{ filler.job.value.status }} · {{ filler.job.value.phase }}</p>
              <p v-if="filler.job.value.errorCode">Код: {{ filler.job.value.errorCode }}</p>
              <p v-if="filler.job.value.preview?.generation">Модель: {{ filler.job.value.preview.generation.model }}</p>
            </details>
          </div>
          <ProfileIssues v-if="!filler.job.value && filler.source.value === 'json'" :issues="filler.issues.value" />
          <ProfileFillerHistory :filler="filler" />
        </template>
      </main>
    </div>
    <template #footer><ProfileFillerFooter :filler="filler" /></template>
  </Dialog>
</template>
<style src="./profile-filler-layout.css"></style>
<style src="./profile-filler-cards.css"></style>
