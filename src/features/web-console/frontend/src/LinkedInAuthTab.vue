<script setup>
import { computed } from 'vue'
import LinkedInAuthStatus from './LinkedInAuthStatus.vue'
import LinkedInAuthHistory from './LinkedInAuthHistory.vue'
import ProfileFillerDialog from './ProfileFillerDialog.vue'
import CommentMonitorCell from './CommentMonitorCell.vue'
import { formatDate, primaryAction, runForAccount } from './linkedin-auth-view'
import { useLinkedInAuth } from './use-linkedin-auth'
import { useProfileFiller } from './use-profile-filler'
import { useCommentMonitor } from './use-comment-monitor'

const auth = useLinkedInAuth()
const filler = useProfileFiller()
const comments = useCommentMonitor()
const busy = computed(() => auth.active.value || filler.active.value)
</script>

<template>
  <Card class="linkedin-auth-card" data-testid="linkedin-auth-tab">
    <template #title>LinkedIn authorization</template>
    <template #subtitle>Local Dolphin and Unipile connection for all students</template>
    <template #content>
      <div class="linkedin-toolbar">
        <InputText v-model="auth.query.value" placeholder="Search student, URL, account or error" data-testid="linkedin-search" />
        <span v-if="auth.active.value" class="linkedin-running-note">One authorization is running</span>
      </div>
      <Message v-if="auth.error.value" severity="error" :closable="false" data-testid="linkedin-page-error">{{ auth.error.value }}</Message>
      <Message v-if="comments.errors.value.page" severity="error" :closable="false"
        data-testid="comment-monitor-page-error">{{ comments.errors.value.page }}</Message>
      <ProgressSpinner v-if="auth.loading.value" class="linkedin-spinner" stroke-width="4" />
      <div v-else class="linkedin-table-wrap">
        <table class="linkedin-table" data-testid="linkedin-accounts-table">
          <thead><tr><th>Student</th><th>LinkedIn</th><th>Dolphin En</th><th>Unipile</th><th>Status</th><th>Last verified</th><th>Comment replies</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="account in auth.filtered.value" :key="account.platformAccountId" :data-testid="`linkedin-account-${account.platformAccountId}`">
              <td><strong>{{ account.clientName }}</strong><small>#{{ account.platformAccountId }}</small></td>
              <td>
                <div v-if="auth.editors.value[account.platformAccountId] || !account.linkedinUrl" class="linkedin-url-editor">
                  <InputText v-model="auth.drafts.value[account.platformAccountId]" placeholder="https://www.linkedin.com/in/.../" :data-testid="`linkedin-url-input-${account.platformAccountId}`" />
                  <Button label="Save" size="small" :loading="auth.saving.value[account.platformAccountId]" :disabled="busy" :data-testid="`linkedin-url-save-${account.platformAccountId}`" @click="auth.save(account)" />
                </div>
                <div v-else class="linkedin-url-value">
                  <a :href="account.linkedinUrl" target="_blank" rel="noreferrer">Open profile</a>
                  <Button label="Edit" size="small" severity="secondary" text :disabled="busy" :data-testid="`linkedin-url-edit-${account.platformAccountId}`" @click="auth.edit(account)" />
                </div>
              </td>
              <td>{{ account.dolphinProfileId || '—' }}</td>
              <td><code>{{ account.unipileAccountId || '—' }}</code><small>{{ account.unipileAccountStatus || '' }}</small></td>
              <td><LinkedInAuthStatus :account="account" :run="runForAccount(auth.runs.value, account)" /></td>
              <td>{{ formatDate(account.lastVerifiedAt) }}</td>
              <td><CommentMonitorCell :account="account" :monitor="comments" /></td>
              <td><div class="linkedin-actions">
                <Button label="Check settings" size="small" severity="secondary" outlined :disabled="busy" :data-testid="`linkedin-check-${account.platformAccountId}`" @click="auth.start(account, 'check')" />
                <Button :label="primaryAction(account).label" size="small" :disabled="busy || Boolean(account.readinessErrorCode)" :data-testid="`linkedin-connect-${account.platformAccountId}`" @click="auth.start(account, primaryAction(account).action)" />
                <Button v-if="account.unipileAccountId" label="Refresh session" size="small" severity="warn" outlined :disabled="busy || Boolean(account.readinessErrorCode)" :data-testid="`linkedin-force-${account.platformAccountId}`" @click="auth.start(account, 'force_reauth')" />
                <Button label="Profile Filler" size="small" severity="help" outlined
                  :disabled="busy" :data-testid="`profile-filler-${account.platformAccountId}`" @click="filler.open(account)" />
              </div></td>
            </tr>
            <tr v-if="!auth.filtered.value.length"><td colspan="8">No LinkedIn accounts found.</td></tr>
          </tbody>
        </table>
      </div>
      <LinkedInAuthHistory :runs="auth.history.value" />
    </template>
  </Card>
  <ProfileFillerDialog :filler="filler" />
</template>
