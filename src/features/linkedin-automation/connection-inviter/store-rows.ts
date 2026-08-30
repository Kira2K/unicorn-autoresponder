import type { ConnectionHistoryItem, ConnectionRun, ConnectionRunStage,
  ConnectionSearchProgress } from './types.ts'
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
    used_search_keys_json: JSON.stringify(run.usedSearchKeys),
    retry_state_json: run.retryState ? JSON.stringify(run.retryState) : null,
    search_progress_json: JSON.stringify(run.searchProgress),
    skip_reason_counters_json: JSON.stringify(run.skipReasonCounters),
    next_action_at: run.nextActionAt ?? null, paused_at: run.pausedAt ?? null,
    executor_id: run.executorId ?? null, heartbeat_at: run.heartbeatAt ?? null,
    error_code: run.errorCode ?? null,
    created_at: run.createdAt, updated_at: run.updatedAt, finished_at: run.finishedAt ?? null
  }
}
const number = (value: unknown) => value === null || value === undefined || value === ''
  ? undefined : Number(value)

function searchProgressFromRow(value: unknown): ConnectionSearchProgress {
  const fallback: ConnectionSearchProgress = { keyIndex: { recruiter: 0, technical: 0 },
    keyTotal: { recruiter: 0, technical: 0 }, page: 0, found: 0, checked: 0,
    streams: { recruiter: { keyIndex: 0, page: 0 }, technical: { keyIndex: 0, page: 0 } },
    recentSearchAt: [], locations: {},
    eligible: 0, skipped: 0, exhausted: { recruiter: false, technical: false }, pass: 1,
    pendingCandidates: [] }
  const progress = parse(value, fallback)
  const legacyAudience = progress.audience === 'technical' ? 'technical' : 'recruiter'
  const legacyStream = progress.sourceKey ? { keyIndex: progress.keyIndex?.[legacyAudience] ?? 0,
    sourceKey: progress.sourceKey, city: progress.city, page: progress.page ?? 0,
    ...(progress.nextCursor ? { nextCursor: progress.nextCursor } : {}) } : undefined
  return { ...fallback, ...progress,
    keyIndex: { ...fallback.keyIndex, ...progress.keyIndex },
    keyTotal: { ...fallback.keyTotal, ...progress.keyTotal },
    streams: {
      recruiter: { ...fallback.streams.recruiter, ...progress.streams?.recruiter,
        ...(legacyStream && legacyAudience === 'recruiter' ? legacyStream : {}) },
      technical: { ...fallback.streams.technical, ...progress.streams?.technical,
        ...(legacyStream && legacyAudience === 'technical' ? legacyStream : {}) }
    },
    exhausted: { ...fallback.exhausted, ...progress.exhausted },
    recentSearchAt: Array.isArray(progress.recentSearchAt) ? progress.recentSearchAt : [],
    locations: progress.locations && typeof progress.locations === 'object' ? progress.locations : {},
    pendingCandidates: Array.isArray(progress.pendingCandidates) ? progress.pendingCandidates : [] }
}

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
    weekKey: String(row.week_key), status: row.status,
    stage: String(row.stage ?? '') as ConnectionRunStage,
    ...(count !== undefined ? { connectionCount: count } : {}),
    ...(count !== undefined ? { dailyLimit: dailyInvitationLimit(count) } : {}),
    ...(daily !== undefined ? { dailyQuota: daily } : {}),
    audienceQuota: parse(row.audience_quota_json, { recruiter: 0, technical: 0 }),
    counters: (() => {
      const counters = parse(row.counters_json,
        { searched: 0, discovered: 0, eligible: 0, sent: 0, skipped: 0 })
      const emptyFunnel = { found: 0, structurallyValid: 0, roleMatched: 0, historyClear: 0,
        preflightPassed: 0, claimed: 0, sent: 0 }
      return { ...counters, sentByAudience: counters.sentByAudience ?? { recruiter: 0, technical: 0 },
        filterFunnel: {
          recruiter: { ...emptyFunnel, ...counters.filterFunnel?.recruiter },
          technical: { ...emptyFunnel, ...counters.filterFunnel?.technical }
        } }
    })(),
    usedSearchKeys: parse(row.used_search_keys_json, []),
    seenPersonIds: [],
    searchProgress: searchProgressFromRow(row.search_progress_json),
    skipReasonCounters: parse(row.skip_reason_counters_json, {}),
    ...(parse(row.retry_state_json, undefined) ? { retryState: parse(row.retry_state_json, undefined) } : {}),
    ...(String(row.next_action_at ?? '').trim() ? { nextActionAt: String(row.next_action_at) } : {}),
    ...(String(row.paused_at ?? '').trim() ? { pausedAt: String(row.paused_at) } : {}),
    ...(String(row.executor_id ?? '').trim() ? { executorId: String(row.executor_id) } : {}),
    ...(String(row.heartbeat_at ?? '').trim() ? { heartbeatAt: String(row.heartbeat_at) } : {}),
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
