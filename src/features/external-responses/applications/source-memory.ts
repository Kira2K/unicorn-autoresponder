import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { assertAllowedUrl } from '../infrastructure/navigation-policy.ts'
import type { SqlOperation } from '../infrastructure/postgres.ts'
import type { Field } from '../types.ts'

const MAX_VARIANTS = 8
const ID = /^[1-9]\d{0,18}$/
const ENGINE = /^[a-z][a-z0-9_-]{0,63}@[a-z0-9][a-z0-9._-]{0,63}$/i
const SIGNATURE = /^[a-f0-9]{64}$/i

export type ApplicationFormBinding = {
  version: 1
  sourceId: string
  companyId: string
  applyOrigin: string
  engine: string
  formSignature: string
  fields: Field[]
  verifiedAt: string
}
export type ApplicationFormScope = { sourceId: string; companyId: string; applyUrl: string; engine: string; formSignature?: string }
export type VerifiedApplicationForm = ApplicationFormScope & { fields: Field[]; formSignature: string; verifiedAt: string; verified: true }

function origin(url: string) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname || url.length > 2048) throw Error('application_memory_invalid_apply_url')
  assertAllowedUrl(parsed.href)
  return parsed.origin
}
function scope(input: ApplicationFormScope) {
  if (!ID.test(input.sourceId) || !ID.test(input.companyId) ||
    BigInt(input.sourceId) > 9223372036854775807n || BigInt(input.companyId) > 9223372036854775807n) throw Error('application_memory_invalid_source_scope')
  if (!ENGINE.test(input.engine)) throw Error('application_memory_invalid_engine')
  if (input.formSignature !== undefined && !SIGNATURE.test(input.formSignature)) throw Error('application_memory_invalid_signature')
  return { sourceId: input.sourceId, companyId: input.companyId, applyOrigin: origin(input.applyUrl), engine: input.engine }
}
function publicFields(value: Field[]): Field[] {
  if (!Array.isArray(value) || value.length > 128) throw Error('application_memory_invalid_fields')
  const fields = value.map(field => {
    if (!field || typeof field.key !== 'string' || !/^[\w.:\[\]-]{1,1024}$/.test(field.key) ||
      typeof field.label !== 'string' || !field.label.trim() || field.label.length > 8000 ||
      typeof field.type !== 'string' || !/^[\w-]{1,40}$/.test(field.type) ||
      typeof field.required !== 'boolean' || !Array.isArray(field.options) || field.options.length > 600 ||
      field.options.some(option => typeof option !== 'string' || option.length > 1000)) throw Error('application_memory_invalid_fields')
    return { key: field.key, label: field.label, type: field.type, required: field.required, options: [...field.options] }
  })
  if (new Set(fields.map(field => field.key)).size !== fields.length) throw Error('application_memory_duplicate_fields')
  if (Buffer.byteLength(JSON.stringify(fields)) > 256 * 1024) throw Error('application_memory_schema_too_large')
  return fields
}
function validBinding(value: unknown): value is ApplicationFormBinding {
  if (!value || typeof value !== 'object') return false
  const binding = value as ApplicationFormBinding
  try {
    if (binding.version !== 1 || !SIGNATURE.test(binding.formSignature) ||
      !Number.isFinite(Date.parse(binding.verifiedAt)) || new Date(binding.verifiedAt).toISOString() !== binding.verifiedAt) return false
    const checked = scope({ sourceId: binding.sourceId, companyId: binding.companyId, applyUrl: binding.applyOrigin, engine: binding.engine })
    return checked.applyOrigin === binding.applyOrigin && digest(publicFields(binding.fields)) === binding.formSignature
  } catch { return false }
}
function variants(state: unknown): ApplicationFormBinding[] {
  if (!state || typeof state !== 'object') return []
  const forms = (state as Record<string, unknown>).applicationForms
  if (!forms || typeof forms !== 'object' || (forms as any).version !== 1 || !Array.isArray((forms as any).variants)) return []
  return (forms as any).variants.filter(validBinding).slice(0, MAX_VARIANTS)
}

/** SQL operation is injected. A saved binding only identifies an observed public form. */
export async function loadApplicationFormMemory(input: ApplicationFormScope, read: SqlOperation): Promise<ApplicationFormBinding | null> {
  const key = scope(input)
  const rows = await read(async session => (await session.query(
    'SELECT collection_state FROM noco.sources WHERE id=$1 AND company_id=$2', [key.sourceId, key.companyId])).rows)
  if (!rows.length) return null
  const matches = variants(rows[0].collection_state).filter(binding => binding.sourceId === key.sourceId &&
    binding.companyId === key.companyId && binding.applyOrigin === key.applyOrigin && binding.engine === key.engine &&
    (!input.formSignature || binding.formSignature === input.formSignature))
  return matches.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))[0] ?? null
}

/** Called only after a fresh form snapshot was verified; never stores answers or applicant data. */
export async function saveVerifiedApplicationFormMemory(input: VerifiedApplicationForm, write: SqlOperation): Promise<ApplicationFormBinding> {
  const key = scope(input)
  if (input.verified !== true || !Number.isFinite(Date.parse(input.verifiedAt)) ||
    new Date(input.verifiedAt).toISOString() !== input.verifiedAt) throw Error('application_memory_unverified')
  const fields = publicFields(input.fields)
  if (digest(fields) !== input.formSignature) throw Error('application_memory_signature_mismatch')
  const binding: ApplicationFormBinding = { version: 1, ...key, formSignature: input.formSignature, fields, verifiedAt: input.verifiedAt }
  await write(async session => {
    const rows = (await session.query('SELECT collection_state FROM noco.sources WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [key.sourceId, key.companyId])).rows
    if (!rows.length) throw Error('application_memory_source_missing')
    const state = rows[0].collection_state
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw Error('application_memory_invalid_state')
    const retained = variants(state).filter(old => !(old.sourceId === key.sourceId && old.companyId === key.companyId &&
      old.applyOrigin === key.applyOrigin && old.engine === key.engine && old.formSignature === binding.formSignature))
    const next = [binding, ...retained].sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt)).slice(0, MAX_VARIANTS)
    await session.query('UPDATE noco.sources SET collection_state=$3::jsonb WHERE id=$1 AND company_id=$2',
      [key.sourceId, key.companyId, JSON.stringify({ ...state, applicationForms: { version: 1, variants: next } })])
  })
  return binding
}
