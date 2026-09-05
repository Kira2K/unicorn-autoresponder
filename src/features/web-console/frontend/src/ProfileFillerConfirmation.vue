<script setup>
import ProfilePreviewSummary from './ProfilePreviewSummary.vue'
import ProfileIssues from './ProfileIssues.vue'
defineProps({ filler: { type: Object, required: true } })
</script>
<template>
  <Dialog :visible="Boolean(filler.confirmation.value)" modal class="profile-confirmation"
    :header="filler.confirmation.value?.kind === 'rollback' ? 'Подтвердить откат' : 'Применить изменения в LinkedIn?'"
    :closable="!filler.pending.value" @update:visible="v => !v && !filler.pending.value && (filler.confirmation.value = null)">
    <template v-if="filler.confirmation.value">
      <p>Ученик: <strong>{{ filler.confirmation.value.job.clientName }}</strong></p>
      <p v-if="filler.confirmation.value.kind === 'rollback'">Будут восстановлены только значения, для которых backend разрешил откат.</p>
      <template v-else>
        <ProfilePreviewSummary :preview="filler.confirmation.value.job.preview" />
        <ProfileIssues :issues="filler.confirmation.value.job.preview?.issues || []" />
        <p>Будет применён именно проверенный план. Заполнение и подтверждение могут занять длительное время.</p>
      </template>
      <Message v-if="filler.error.value" severity="error" :closable="false">{{ filler.error.value }}</Message>
    </template>
    <template #footer>
      <Button label="Вернуться к проверке" severity="secondary" outlined :disabled="filler.pending.value"
        @click="filler.confirmation.value = null" />
      <Button :label="filler.confirmation.value?.kind === 'rollback' ? 'Подтверждаю откат' : 'Подтверждаю применение'"
        :disabled="filler.pending.value" :loading="filler.pending.value" data-testid="profile-confirm-submit"
        @click="filler.confirm" />
    </template>
  </Dialog>
</template>
