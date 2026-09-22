<script setup>
import LinkedInAuthStatus from './LinkedInAuthStatus.vue'
import ProfileFillerAccountAction from './ProfileFillerAccountAction.vue'
import CommentMonitorCell from './CommentMonitorCell.vue'
import ConnectionInviterCell from './ConnectionInviterCell.vue'
import PostWriterCell from './PostWriterCell.vue'
import { formatDate, primaryAction, runForAccount } from './linkedin-auth-view'
defineProps({ account: Object, auth: Object, filler: Object, comments: Object, connections: Object, busy: Boolean })
</script>
<template>
  <section class="manual-controls" :data-testid="`linkedin-manual-${account.platformAccountId}`">
    <div class="actions"><ProfileFillerAccountAction :account="account" :filler="filler" :blocked="auth.active.value" /><PostWriterCell :account="account" /></div>
    <details open><summary>Подключение аккаунта</summary><div class="section-content">
      <LinkedInAuthStatus :account="account" :run="runForAccount(auth.runs.value, account)" /><small>Проверено: {{ formatDate(account.lastVerifiedAt) }}</small>
      <div v-if="auth.editors.value[account.platformAccountId] || !account.linkedinUrl" class="url-editor"><InputText v-model="auth.drafts.value[account.platformAccountId]" placeholder="https://www.linkedin.com/in/.../" :data-testid="`linkedin-url-input-${account.platformAccountId}`" /><Button label="Save" size="small" :loading="auth.saving.value[account.platformAccountId]" :disabled="busy" :data-testid="`linkedin-url-save-${account.platformAccountId}`" @click="auth.save(account)" /></div>
      <div v-else class="actions"><a :href="account.linkedinUrl" target="_blank" rel="noreferrer">Открыть профиль</a><Button label="Edit" size="small" severity="secondary" text :disabled="busy" :data-testid="`linkedin-url-edit-${account.platformAccountId}`" @click="auth.edit(account)" /></div>
      <div class="actions"><Button label="Check settings" size="small" severity="secondary" outlined :disabled="busy" :data-testid="`linkedin-check-${account.platformAccountId}`" @click="auth.start(account, 'check')" /><Button :label="primaryAction(account).label" size="small" :disabled="busy || Boolean(account.readinessErrorCode)" :data-testid="`linkedin-connect-${account.platformAccountId}`" @click="auth.start(account, primaryAction(account).action)" /><Button v-if="account.unipileAccountId" label="Refresh session" size="small" severity="warn" outlined :disabled="busy || Boolean(account.readinessErrorCode)" :data-testid="`linkedin-force-${account.platformAccountId}`" @click="auth.start(account, 'force_reauth')" /></div>
      <details><summary>Реквизиты подключения</summary><small>Dolphin En: {{ account.dolphinProfileId || '—' }}</small><small>Unipile: <code>{{ account.unipileAccountId || '—' }}</code> {{ account.unipileAccountStatus || '' }}</small></details>
    </div></details>
    <details data-testid="manual-invitations"><summary>Приглашения и отзыв</summary><div class="section-content"><ConnectionInviterCell :account="account" :inviter="connections" :disabled="busy" /></div></details>
    <details data-testid="manual-comments"><summary>Комментарии</summary><div class="section-content"><CommentMonitorCell :account="account" :monitor="comments" /></div></details>
  </section>
</template>
<style scoped>
.manual-controls{display:grid;gap:14px;min-width:0}.actions,.url-editor{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.url-editor input{width:100%;min-width:0}.section-content{display:grid;gap:10px;padding:12px 0}.manual-controls>details{border-top:1px solid var(--p-content-border-color);padding-top:12px}summary{cursor:pointer}small{display:block;color:var(--p-text-muted-color);margin-top:5px}code{overflow-wrap:anywhere}.manual-controls :deep(.connection-inviter),.manual-controls :deep(.comment-monitor){min-width:0;max-width:100%}
</style>
