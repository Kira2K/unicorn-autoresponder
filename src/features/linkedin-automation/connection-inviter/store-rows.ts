import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { dailyInvitationLimit } from './limits.ts'

const parse = (value: unknown, fallback: any) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback } catch { return fallback }
}
export const createdItem = (value: any) =>
  Array.isArray(value) ? value[0] : value?.list?.[0] ?? value?.data?.[0] ?? value

export function runRow(run: ConnectionRun) {
  return {
    run_key: run.runKey, run_id: run.runId, platform_account_id: run.platformAccountId,
    client_id: run.clientId, client_name: run.clientName, unipile_account_id: run.accountId,
    stack_id: run.stackId ?? null, stack: run.stack ?? null,
    safe_recruiter_only: run.safeRecruiterOnly, local_date: run.localDate, week_key: run.weekKey,
    status: run.status, stage: run.stage, connection_count: run.connectionCount ?? null,
    weekly_limit: null, daily_quota: run.dailyQuota ?? null,
    audience_quota_json: JSON.stringify(run.audienceQuota), counters_json: JSON.stringify(run.counters),
    used_search_keys_json: JSON.stringify(run.usedSearchKeys), error_code: run.errorCode ?? null,
    created_at: run.createdAt, updated_at: run.updatedAt, finished_at: run.finishedAt ?? null
  }
}
const number = (value: unknown) => value === null || value === undefined || value === ''
  ? undefined : Number(value)

export function runFromRow(row: any): ConnectionRun {
  const count = number(row.connection_count)
  const daily = number(row.daily_quota)
  return {
    runId: String(row.run_id), runKey: String(row.run_key),
    platformAccountId: Number(row.platform_account_id), clientId: Number(row.client_id),
    clientName: String(row.client_name ?? ''), accountId: String(row.unipile_account_id ?? ''),
    ...(Number(row.stack_id) > 0 ? { stackId: Number(row.stack_id) } : {}),
    ...(String(row.stack ?? '').trim() ? { stack: String(row.stack).trim() } : {}),
    safeRecruiterOnly: Boolean(row.safe_recruiter_only), localDate: String(row.local_date),
    weekKey: String(row.week_key), status: row.status, stage: String(row.stage ?? ''),
    ...(count !== undefined ? { connectionCount: count } : {}),
    ...(count !== undefined ? { dailyLimit: dailyInvitationLimit(count) } : {}),
    ...(daily !== undefined ? { dailyQuota: daily } : {}),
    audienceQuota: parse(row.audience_quota_json, { recruiter: 0, technical: 0 }),
    counters: parse(row.counters_json, { searched: 0, discovered: 0, eligible: 0, sent: 0, skipped: 0 }),
    usedSearchKeys: parse(row.used_search_keys_json, []),
    ...(String(row.error_code ?? '').trim() ? { errorCode: String(row.error_code) } : {}),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    ...(String(row.finished_at ?? '').trim() ? { finishedAt: String(row.finished_at) } : {}),
    recordId: Number(row.Id ?? row.id) || undefined
  }
}

export function historyRow(value: ConnectionHistoryItem) {
  return {
    history_key: value.historyKey, run_id: value.runId,
    platform_account_id: value.platformAccountId, unipile_account_id: value.accountId,
    person_id: value.personId, audience: value.audience, search_key: value.searchKey,
    name: value.name, headline: value.headline, location: value.location,
    profile_url: value.profileUrl ?? null, status: value.status, reason_code: value.reasonCode ?? null,
    request_id: value.requestId ?? null, discovered_at: value.discoveredAt, updated_at: value.updatedAt,
    sent_at: value.sentAt ?? null, verified_at: value.verifiedAt ?? null
  }
}

export function historyFromRow(row: any): ConnectionHistoryItem {
  return {
    historyKey: String(row.history_key), runId: String(row.run_id),
    platformAccountId: Number(row.platform_account_id), accountId: String(row.unipile_account_id),
    personId: String(row.person_id), audience: row.audience, searchKey: String(row.search_key),
    name: String(row.name ?? ''), headline: String(row.headline ?? ''), location: String(row.location ?? ''),
    ...(String(row.profile_url ?? '').trim() ? { profileUrl: String(row.profile_url) } : {}),
    status: row.status, ...(String(row.reason_code ?? '').trim() ? { reasonCode: String(row.reason_code) } : {}),
    ...(String(row.request_id ?? '').trim() ? { requestId: String(row.request_id) } : {}),
    discoveredAt: String(row.discovered_at), updatedAt: String(row.updated_at),
    ...(String(row.sent_at ?? '').trim() ? { sentAt: String(row.sent_at) } : {}),
    ...(String(row.verified_at ?? '').trim() ? { verifiedAt: String(row.verified_at) } : {}),
    recordId: Number(row.Id ?? row.id) || undefined
  }
}
