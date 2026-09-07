<script setup>
import ProfileFillerConfirmation from './ProfileFillerConfirmation.vue'
import { profileStage } from './profile-workflow-view.js'
defineProps({ filler: { type: Object, required: true } })
</script>
<template>
  <div class="profile-footer" data-testid="profile-filler-footer">
    <div class="profile-footer-note">
      <span v-if="filler.active.value">Можно свернуть. Работа продолжится.</span>
      <span v-else-if="!filler.job.value || profileStage(filler.job.value) === 1">Без подтверждения LinkedIn не изменится.</span>
      <Button v-if="filler.job.value && !filler.busy.value" label="Новое CV"
        severity="secondary" text data-testid="profile-generation-restart" @click="filler.restartGeneration" />
      <Button v-if="filler.job.value?.rollbackAvailable" label="Откатить изменение" severity="danger" text
        :disabled="filler.busy.value" data-testid="profile-filler-rollback" @click="filler.rollback" />
    </div>
    <div class="profile-footer-buttons">
      <Button :label="filler.active.value ? 'Свернуть' : 'Закрыть'" severity="secondary" outlined
        data-testid="profile-filler-close" @click="filler.close" />
      <template v-if="!filler.job.value">
        <Button v-if="filler.source.value === 'json'" label="Подготовить изменения из JSON"
          :disabled="filler.busy.value || !filler.draft.value" :loading="filler.pending.value"
          data-testid="profile-filler-preview" @click="filler.preview" />
        <Button v-else label="Подготовить изменения" icon="pi pi-sparkles" :loading="filler.pending.value"
          :disabled="filler.busy.value || (filler.source.value === 'upload' && !filler.cvFile.value)"
          data-testid="profile-filler-generate" @click="filler.generate()" />
      </template>
      <template v-else-if="filler.job.value.status === 'preview_ready'">
        <Button v-if="filler.dirty.value && !filler.job.value.preview?.generation" label="Пересобрать Preview"
          :disabled="filler.busy.value" data-testid="profile-filler-recheck" @click="filler.retryPreview" />
        <Button label="Применить в LinkedIn" :loading="filler.pending.value"
          :disabled="filler.busy.value || filler.dirty.value || filler.blockingIssues.value"
          :aria-describedby="filler.blockingIssues.value ? 'profile-apply-blocked' : undefined"
          data-testid="profile-filler-apply" @click="filler.apply" />
      </template>
      <Button v-else-if="filler.job.value.status === 'waiting_retry'" label="Продолжить подготовку"
        :disabled="filler.busy.value || filler.retrySeconds.value > 0" :loading="filler.pending.value"
        data-testid="profile-generation-resume" @click="filler.resume" />
    </div>
    <small v-if="filler.blockingIssues.value && profileStage(filler.job.value) === 1" id="profile-apply-blocked">
      Применение заблокировано: исправьте указанные ошибки.</small>
  </div>
  <ProfileFillerConfirmation :filler="filler" />
</template>
