import {createHash, createHmac} from 'node:crypto';

type CommandBase = {
  event_id: string; client_id: string; account_id: string; linklab_version: string; confirmed_at: string;
};
export type AccountCommand = CommandBase & ({command: 'ban'} | {
  command: 'replacement' | 'unban'; cycle_id: string; old_account_id: string; account_url: string;
});
type WireCommand = AccountCommand & {schema_version: 1; event_type: 'linkedin.account_command'; source: 'unicorn'};
const commonKeys = ['schema_version', 'event_type', 'source', 'command', 'event_id',
  'client_id', 'account_id', 'linklab_version', 'confirmed_at'];
const recoveryKeys = ['cycle_id', 'old_account_id', 'account_url'];
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const eventUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(code: string): never {throw new Error('crm_account_command_' + code);}
function bigint(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n)
    fail('payload_invalid');
}
function validate(value: unknown): WireCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('payload_invalid');
  const p = value as Record<string,unknown>;
  const recovery = p.command === 'replacement' || p.command === 'unban';
  const keys = recovery ? [...commonKeys, ...recoveryKeys] : commonKeys;
  if (Object.keys(p).length !== keys.length || keys.some(k => !(k in p)) ||
    p.schema_version !== 1 || p.event_type !== 'linkedin.account_command' || p.source !== 'unicorn' ||
    (!recovery && p.command !== 'ban') || typeof p.event_id !== 'string' || !eventUuid.test(p.event_id))
    fail('payload_invalid');
  for (const key of ['client_id', 'account_id', 'linklab_version', ...(recovery ? ['cycle_id', 'old_account_id'] : [])]) bigint(p[key]);
  if (typeof p.confirmed_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(p.confirmed_at) ||
    !Number.isFinite(Date.parse(p.confirmed_at))) fail('payload_invalid');
  if (recovery && ((p.command === 'unban') !== (p.account_id === p.old_account_id) ||
    typeof p.account_url !== 'string' || p.account_url.length > 2048 ||
    !/^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%\-]+\/?$/.test(p.account_url))) fail('payload_invalid');
  return p as unknown as WireCommand;
}

/** Build once; the caller retains the event ID and these exact bytes for any retry. */
export function accountCommandBody(command: AccountCommand): Buffer {
  const event = validate({schema_version: 1, event_type: 'linkedin.account_command', source: 'unicorn', ...command});
  return Buffer.from(JSON.stringify(event), 'utf8');
}

/** One API call only. This module does not change SQL, account bindings or the sending schedule. */
export async function sendAccountCommand(
  input: {body: Buffer; expectedStudentId: string},
  options: {baseUrl: string; secret: string; fetch?: typeof globalThis.fetch; now?: () => number},
): Promise<{studentId: string; status: 'blocked' | 'warmup'; warmupStartedOn?: string}> {
  const expectedStudentId = input.expectedStudentId;
  if (!Buffer.isBuffer(input.body) || input.body.length === 0 || input.body.length > 8192 ||
    !uuid.test(expectedStudentId)) fail('payload_invalid');
  // Copy before awaiting: mutating a caller's Buffer cannot change the signed request in flight.
  const body = Buffer.from(input.body);
  let event: WireCommand;
  try {event = validate(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body)));}
  catch {return fail('payload_invalid');}
  let endpoint: URL;
  try {endpoint = new URL('/integrations/linkedin/account-commands/', options.baseUrl);}
  catch {return fail('endpoint_invalid');}
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) fail('endpoint_invalid');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(options.secret)) fail('secret_invalid');
  const timestamp = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  if (!Number.isSafeInteger(timestamp) || !/^\d{10,11}$/.test(String(timestamp))) fail('timestamp_invalid');
  const signature = createHmac('sha256', options.secret).update('v1:' + timestamp + ':', 'ascii').update(body).digest('hex');
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(endpoint.href, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), body: new Uint8Array(body),
      headers: {'Content-Type': 'application/json', 'X-CRM-Timestamp': String(timestamp), 'X-CRM-Signature': 'v1=' + signature},
    });
  } catch {return fail('delivery_uncertain');}
  if (response.status !== 200 && response.status !== 201) {
    await response.body?.cancel().catch(() => {});
    return fail('http_' + response.status);
  }
  let receipt: Record<string,unknown>;
  try {
    if (!response.body) return fail('receipt_invalid');
    const reader = response.body.getReader(), chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 16_384) {await reader.cancel(); return fail('receipt_invalid');}
        chunks.push(Buffer.from(next.value));
      }
    } finally {reader.releaseLock();}
    receipt = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return fail('receipt_invalid');
  } catch {return fail('receipt_invalid');}
  for (const key of ['event_id', 'client_id', 'account_id', 'command', 'linklab_version'] as const)
    if (receipt[key] !== event[key]) fail('receipt_mismatch');
  const status = event.command === 'ban' ? 'blocked' : 'warmup';
  if (receipt.student_id !== expectedStudentId || receipt.payload_sha256 !== createHash('sha256').update(body).digest('hex') ||
    receipt.state !== 'applied' || receipt.effects_applied !== true || receipt.current !== true ||
    receipt.current_linklab_version !== event.linklab_version || receipt.status !== status || receipt.current_status !== status)
    fail('receipt_mismatch');
  if (event.command !== 'ban' && (receipt.cycle_id !== event.cycle_id ||
    typeof receipt.warmup_started_on !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(receipt.warmup_started_on))) fail('receipt_mismatch');
  return {studentId: expectedStudentId, status,
    ...(status === 'warmup' ? {warmupStartedOn: receipt.warmup_started_on as string} : {})};
}
