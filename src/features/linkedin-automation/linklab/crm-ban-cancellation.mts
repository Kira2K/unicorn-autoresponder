import {createHash} from 'node:crypto';
import {requestCrmAccount, type CrmCommandOptions} from './crm-account-command.mts';

export type BanCancellation = {
  clientId: number;
  accountId: number;
  studentId: string;
  linklabVersion: string;
  banUndoVersion: string;
};

/** The source row version and timestamp keep the operation identical after a lost reply. */
export function banCancellationBody(input: BanCancellation): Buffer {
  const proof = /^([1-9]\d{0,9}):([1-9]\d{0,18}):(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z)$/.exec(input.banUndoVersion);
  if (!Number.isSafeInteger(input.clientId) || input.clientId < 1 || !Number.isSafeInteger(input.accountId) || input.accountId < 1 ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(input.studentId) || !proof ||
    proof[2] !== input.linklabVersion || !Number.isFinite(Date.parse(proof[3]))) throw Error('crm_ban_cancel_invalid');
  const identity = `unicorn-ban-cancellation-v1:${input.clientId}:${input.accountId}:${input.banUndoVersion}`;
  const bytes = createHash('sha256').update(identity).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  const eventId = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  return Buffer.from(JSON.stringify({schema_version: 1, event_type: 'linkedin.ban_cancellation', source: 'unicorn',
    event_id: eventId, client_id: String(input.clientId), account_id: String(input.accountId),
    linklab_version: proof[2], ban_version: proof[1], confirmed_at: proof[3]}));
}

export function createBanCancellation(options?: CrmCommandOptions) {
  if (!options) return undefined;
  return async (input: BanCancellation): Promise<void> => {
    const body = banCancellationBody(input);
    const event = JSON.parse(body.toString('utf8'));
    const receipt = await requestCrmAccount(body, options, '/integrations/linkedin/ban-cancellations/');
    const identityKeys = ['event_id', 'client_id', 'account_id', 'linklab_version', 'ban_version', 'confirmed_at'];
    if (identityKeys.some(key => receipt[key] !== event[key]) || receipt.student_id !== input.studentId ||
      receipt.payload_sha256 !== createHash('sha256').update(body).digest('hex') ||
      receipt.state !== 'applied' || receipt.current !== true || receipt.stage_preserved !== true ||
      receipt.source_banned !== false || receipt.crm_banned !== false ||
      receipt.current_linklab_version !== event.linklab_version) throw Error('crm_ban_cancel_receipt_invalid');
  };
}
