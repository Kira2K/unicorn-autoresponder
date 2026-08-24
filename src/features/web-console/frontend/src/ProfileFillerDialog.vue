<script setup>
import { downloadProfileFile, fileSize } from './profile-file'
import ProfileComparison from './ProfileComparison.vue'
import ProfileDraftEditor from './ProfileDraftEditor.vue'
import ProfileFillerProgress from './ProfileFillerProgress.vue'
import ProfileIssues from './ProfileIssues.vue'
import ProfileIssueFixer from './ProfileIssueFixer.vue'

defineProps({ filler: { type: Object, required: true } })

function errorText(code) {
  if (code === 'noco_rate_limited') return 'NocoDB is busy. Wait 30 seconds and try again.'
  if (code === 'profile_rollback_state_changed') return 'LinkedIn changed after this job. Rollback was blocked.'
  return code ? `Operation stopped: ${code}` : ''
}
</script>

<template>
  <Dialog :visible="filler.visible.value" modal header="LinkedIn Profile Filler"
    class="profile-filler-dialog" :closable="!filler.active.value" @update:visible="v => !v && filler.close()">
    <p v-if="filler.account.value"><strong>{{ filler.account.value.clientName }}</strong></p>
    <Message v-if="filler.error.value" severity="error" :closable="false">{{ filler.error.value }}</Message>

    <div v-if="!filler.job.value" class="profile-filler-input">
      <label class="profile-file-drop" for="profile-file" @dragover.prevent @drop="filler.dropFile"
        data-testid="profile-filler-drop">
        <i class="pi pi-upload" /><strong>Drop profile.json here</strong>
        <span>or click to choose a JSON file · maximum 250 KB</span>
        <input id="profile-file" type="file" accept=".json,application/json"
          data-testid="profile-filler-file" @change="filler.chooseFile" />
      </label>
      <div v-if="filler.selectedFile.value" class="profile-file-selected">
        <i class="pi pi-file" /><strong>{{ filler.selectedFile.value.name }}</strong>
        <span>{{ fileSize(filler.selectedFile.value.size) }}</span>
      </div>
      <ProfileDraftEditor v-if="filler.draft.value" :model-value="filler.draft.value"
        @update:model-value="filler.updateDraft" />
      <ProfileIssues :issues="filler.issues.value" />
      <Button v-if="filler.draft.value" label="Download normalized JSON" severity="secondary" outlined
        @click="downloadProfileFile(filler.draft.value)" />
      <Button label="Build LinkedIn preview" :disabled="!filler.draft.value"
        data-testid="profile-filler-preview" @click="filler.preview" />
    </div>

    <div v-else class="profile-filler-content" data-testid="profile-filler-job">
      <p><strong>Status:</strong> {{ filler.job.value.status }}</p>
      <p><strong>Stage:</strong> {{ filler.job.value.phase }}</p>
      <ProgressSpinner v-if="filler.active.value" class="linkedin-spinner" stroke-width="4" />
      <ProfileFillerProgress v-if="filler.job.value.result?.steps"
        :result="filler.job.value.result" :preview-steps="filler.job.value.preview?.steps" />
      <template v-if="filler.job.value.preview">
        <ProfileDraftEditor v-if="filler.draft.value" :model-value="filler.draft.value"
          @update:model-value="filler.updateDraft" />
        <ProfileIssues :issues="filler.issues.value" />
        <ProfileIssueFixer v-if="filler.draft.value"
          :account-id="filler.account.value.platformAccountId" :document="filler.draft.value"
          :issues="filler.issues.value" @resolve="filler.resolveIssues" />
        <Button v-if="filler.draft.value" label="Download normalized JSON" severity="secondary" outlined
          @click="downloadProfileFile(filler.draft.value)" />
        <Message v-if="filler.dirty.value" severity="warn" :closable="false">
          Draft changed. Rebuild Preview before Apply.
        </Message>
        <Message v-if="filler.blockingIssues.value" severity="error" :closable="false">
          Apply is blocked. Fix the fields marked as errors and rebuild Preview.
        </Message>
        <h4>Review changes</h4>
        <ProfileComparison :steps="filler.job.value.preview.steps" />
        <Button v-if="filler.dirty.value" label="Rebuild preview" severity="secondary"
          data-testid="profile-filler-recheck" @click="filler.retryPreview" />
        <Button v-if="filler.job.value.status === 'preview_ready'" label="Apply confirmed preview"
          severity="warn" :disabled="filler.dirty.value || filler.blockingIssues.value"
          data-testid="profile-filler-apply"
          @click="filler.apply" />
      </template>
      <Message v-if="filler.job.value.status === 'needs_expert_review'" severity="error" :closable="false">
        Execution stopped at the failed step. Completed steps were not repeated.
      </Message>
      <Message v-if="filler.job.value.status === 'pending_verification'" severity="warn" :closable="false">
        LinkedIn has not confirmed every accepted change yet.
      </Message>
      <Message v-if="filler.job.value.errorCode" severity="error" :closable="false">
        {{ errorText(filler.job.value.errorCode) }}
      </Message>
      <Button v-if="filler.job.value.rollbackAvailable" label="Roll back this change"
        severity="danger" outlined data-testid="profile-filler-rollback" @click="filler.rollback" />
    </div>
    <div class="profile-filler-history" data-testid="profile-filler-history">
      <h4>Recent runs</h4><ul>
        <li v-for="item in filler.history.value" :key="item.jobId">
          <button type="button" class="profile-history-button" @click="filler.showHistory(item)">
            <strong>{{ item.status }}</strong> · {{ item.phase }}<small>{{ item.updatedAt }}</small>
          </button>
        </li><li v-if="!filler.history.value.length">No previous runs.</li>
      </ul>
    </div>
  </Dialog>
</template>
