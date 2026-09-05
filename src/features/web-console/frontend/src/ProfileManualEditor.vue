<script setup>
import ProfileDraftEditor from './ProfileDraftEditor.vue'
import ProfileIssueFixer from './ProfileIssueFixer.vue'
import { downloadProfileFile } from './profile-file'
defineProps({ filler: { type: Object, required: true } })
</script>
<template>
  <details v-if="filler.draft.value && !filler.job.value?.preview?.generation" class="profile-advanced">
    <summary>Для специалиста: редактирование JSON</summary>
    <fieldset :disabled="filler.busy.value">
      <ProfileDraftEditor :model-value="filler.draft.value" @update:model-value="filler.updateDraft" />
      <ProfileIssueFixer :account-id="filler.account.value.platformAccountId" :document="filler.draft.value"
        :issues="filler.issues.value" @resolve="filler.resolveIssues" />
      <Button label="Скачать нормализованный JSON" severity="secondary" outlined
        @click="downloadProfileFile(filler.draft.value)" />
    </fieldset>
  </details>
</template>
