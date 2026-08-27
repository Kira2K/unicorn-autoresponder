import { codedError } from '../errors.ts'

const FINAL_STATUSES = new Set(['moved to filling', 'filled'])

function text(value: unknown) {
  return String(value ?? '').trim()
}

function linkedId(value: unknown): number | undefined {
  const item = Array.isArray(value) ? value[0] : value
  const id = Number((item as any)?.Id ?? (item as any)?.id ?? value)
  return Number.isFinite(id) && id > 0 ? id : undefined
}

function clientId(row: any) {
  return linkedId(row.client) ?? linkedId(row.clients) ??
    linkedId(row.rel_cvProcessing_client) ?? linkedId(row.clients_id)
}

function timestamp(row: any) {
  return Date.parse(text(row.UpdatedAt ?? row.updated_at ?? row.CreatedAt ?? row.created_at)) || 0
}

export function selectFinalEnglishCv(rows: any[], expectedClientId: number) {
  const candidates = rows.filter(row => clientId(row) === expectedClientId &&
    FINAL_STATUSES.has(text(row.status).toLowerCase()) && text(row.en_version_url))
  candidates.sort((left, right) => timestamp(right) - timestamp(left) ||
    Number(right.Id ?? 0) - Number(left.Id ?? 0))
  const selected = candidates[0]
  if (!selected) throw codedError('profile_cv_not_ready',
    'A confirmed final English CV is not available.')
  return {
    url: text(selected.en_version_url),
    revision: text(selected.UpdatedAt ?? selected.updated_at ?? selected.Id)
  }
}
