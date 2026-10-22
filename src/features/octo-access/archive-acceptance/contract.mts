import { createHash } from 'node:crypto';
export class ArchiveFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export function requireCheck(ok: unknown, code: string): asserts ok { if (!ok) throw new ArchiveFailure(code); }
export interface FixtureIdentity {
  uuid: string; title: string; description: string; folder: string; createdAt: number; identity: string;
}
export interface Marker { origin: string; key: string; value: string; cookie: string }
export const ARCHIVE_ORIGIN = 'https://example.org';
export const archiveMarker = (value: string): Marker => ({ origin: ARCHIVE_ORIGIN, key: 'unicorn-octo-archive',
  cookie: 'unicorn_octo_archive', value });
export function readFixtureEmails(env: Readonly<Record<string, string | undefined>>) {
  const result = {} as Record<'Alex' | 'Bob', string>;
  for (const name of ['Alex', 'Bob'] as const) {
    const email = env[`OCTO_E2E_${name.toUpperCase()}_EMAIL`] ?? `${name.toLowerCase()}.octo@example.com`;
    requireCheck(new RegExp(`^${name.toLowerCase()}\\.octo(?:\\.[a-z0-9-]+)?@example\\.com$`).test(email),
      'archive_synthetic_fixture_email_required');
    result[name] = email;
  }
  return result;
}
export interface OwnerPreflight {
  schema: 1; id: string; machine: string; account: string; preparedAt: number; knownProfiles: string[];
}
export interface OwnerRequest {
  schema: 1; id: string; runId: string; sourceMachine: string; preflightId: string; issuedAt: number;
  cycle: number; operation: 'reopen'; profile: FixtureIdentity; marker: Marker;
}
export interface OwnerProof {
  schema: 1; requestId: string; digest: string; machine: string; account: string; uuid: string; cycle: number;
  startedAt: number; finishedAt: number; fresh: boolean; passed: boolean; noPassword: boolean;
  markers: boolean; identity: boolean; stopped: boolean; error?: string;
  upstreamCode?: string; httpStatus?: number;
  archiveErrors?: Array<'ProfileRequiresUserPasswordError' | 'InvalidProfilePasswordException'>;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const requestDigest = (request: OwnerRequest) => digest(request);
export const accountDigest = (email: string) => digest(email.trim().toLowerCase());
export function profileIdentity(raw: Record<string, unknown>): string {
  requireCheck(raw.fingerprint && typeof raw.fingerprint === 'object', 'archive_fingerprint_missing');
  return digest({ fingerprint: raw.fingerprint, storage_options: raw.storage_options, proxy: (raw.proxy as any)?.uuid ?? null });
}
export function assertNewFixture(request: OwnerRequest, preflight: OwnerPreflight) {
  requireCheck(request.preflightId === preflight.id && request.sourceMachine !== preflight.machine,
    'archive_independent_owner_required');
  requireCheck(preflight.preparedAt < request.profile.createdAt && request.profile.createdAt <= request.issuedAt &&
    !preflight.knownProfiles.includes(request.profile.uuid), 'archive_fresh_fixture_required');
}
export function acceptOwnerProof(request: OwnerRequest, proof: OwnerProof, preflight: OwnerPreflight) {
  assertNewFixture(request, preflight);
  requireCheck(proof.schema === 1 && proof.requestId === request.id && proof.digest === requestDigest(request) &&
    proof.uuid === request.profile.uuid && proof.cycle === request.cycle && proof.machine === preflight.machine &&
    proof.account === preflight.account && proof.startedAt >= request.issuedAt && proof.finishedAt >= proof.startedAt,
  'archive_owner_proof_mismatch');
  requireCheck(proof.passed && proof.noPassword && proof.markers && proof.identity && proof.stopped &&
    (request.cycle !== 1 || proof.fresh), 'archive_owner_restore_failed');
}
export function parsePreflight(value: any): OwnerPreflight {
  requireCheck(value?.schema === 1 && typeof value.id === 'string' && typeof value.machine === 'string' &&
    typeof value.account === 'string' && Number.isFinite(value.preparedAt) && Array.isArray(value.knownProfiles) &&
    value.knownProfiles.every((id: unknown) => typeof id === 'string'), 'archive_preflight_invalid');
  return value;
}
export function parseRequest(value: any): OwnerRequest {
  const p = value?.profile, m = value?.marker;
  requireCheck(value?.schema === 1 && ['id','runId','sourceMachine','preflightId'].every(k =>
    typeof value[k] === 'string' && /^[a-z0-9_-]{1,100}$/i.test(value[k])) &&
    value.operation === 'reopen' && Number.isFinite(value.issuedAt) &&
    Number.isInteger(value.cycle) && value.cycle >= 1 && value.cycle <= 3 &&
    p && /^[a-f0-9]{32}$/.test(p.uuid) && /^[a-f0-9]{32}$/.test(p.folder) &&
    typeof p.title === 'string' && p.title.length <= 90 && typeof p.description === 'string' &&
    /^(unicorn-octo-archive:|unicorn-octo:)/.test(p.description) && Number.isFinite(p.createdAt) &&
    /^[a-f0-9]{64}$/.test(p.identity), 'archive_request_invalid');
  const expected = archiveMarker('');
  requireCheck(m, 'archive_saved_marker_required');
  requireCheck(m.origin === expected.origin && m.key === expected.key &&
    m.cookie === expected.cookie && /^[a-z0-9:_-]{1,200}$/i.test(m.value), 'archive_marker_invalid');
  return value;
}
export function parseProof(value: any): OwnerProof {
  requireCheck(value?.schema === 1 && ['requestId','digest','machine','account','uuid'].every(k =>
    typeof value[k] === 'string' && /^[a-z0-9_-]{1,100}$/i.test(value[k])) &&
    Number.isInteger(value.cycle) && Number.isFinite(value.startedAt) && Number.isFinite(value.finishedAt) &&
    ['fresh','passed','noPassword','markers','identity','stopped'].every(k => typeof value[k] === 'boolean'),
  'archive_owner_proof_invalid');
  return { schema: 1, requestId: value.requestId, digest: value.digest, machine: value.machine, account: value.account,
    uuid: value.uuid, cycle: value.cycle, startedAt: value.startedAt, finishedAt: value.finishedAt,
    fresh: value.fresh, passed: value.passed, noPassword: value.noPassword, markers: value.markers,
    identity: value.identity, stopped: value.stopped, ...(value.error ? failureFields({ code: value.error,
    details: { upstreamCode: value.upstreamCode, httpStatus: value.httpStatus } }) : {}),
    ...(Array.isArray(value.archiveErrors) ? { archiveErrors: value.archiveErrors.filter((e: unknown) =>
      e === 'ProfileRequiresUserPasswordError' || e === 'InvalidProfilePasswordException').slice(0, 2) } : {}) };
}
// Only bounded machine codes cross the diagnostic boundary; never upstream messages/stacks.
export function failureFields(error: unknown): { error: string; upstreamCode?: string; httpStatus?: number } {
  const e = error as any, code = e?.code;
  const result: { error: string; upstreamCode?: string; httpStatus?: number } = {
    error: typeof code === 'string' && /^(archive_|octo_|invalid_octo_|local_api_)[a-z0-9_]{1,90}$/.test(code)
      ? code : 'archive_operation_failed'
  };
  if (typeof e?.details?.upstreamCode === 'string' && /^[a-z_.-]{1,80}$/i.test(e.details.upstreamCode))
    result.upstreamCode = e.details.upstreamCode;
  if (Number.isInteger(e?.details?.httpStatus)) result.httpStatus = e.details.httpStatus;
  return result;
}
