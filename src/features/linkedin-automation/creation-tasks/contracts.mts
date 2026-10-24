import { IntakeError } from '../console-intake/contracts.mts';
export const taskStatuses = ['не начата', 'блок', 'сделана экспертом', 'выполнение подтверждено'] as const;
export type TaskStatus = typeof taskStatuses[number];
export const studentLocked = (status: unknown) => status === taskStatuses[2] || status === taskStatuses[3];
export const providerStatuses = taskStatuses.slice(0, 3);
export function taskId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new IntakeError('linkedin_task_invalid_id');
  return id;
}
export function providerStatus(value: unknown): TaskStatus {
  if (!providerStatuses.includes(value as TaskStatus)) throw new IntakeError('linkedin_task_invalid_status');
  return value as TaskStatus;
}
export interface CreationTask {
  id: number; clientId: number; linkedinAccountId: number; outlookAccountId: number;
  status: TaskStatus; version: number; proxyProfileId?: number; proxyUuid?: string; proxySavedAt?: string;
  createdAt: string; updatedAt: string;
}
export function taskRow(row: Record<string, unknown>): CreationTask {
  return { id: Number(row.id), clientId: Number(row.client_id), linkedinAccountId: Number(row.linkedin_account_id),
    outlookAccountId: Number(row.outlook_account_id), status: row.status as TaskStatus, version: Number(row.version),
    ...(row.proxy_profile_id ? { proxyProfileId: Number(row.proxy_profile_id) } : {}),
    ...(row.proxy_uuid ? { proxyUuid: String(row.proxy_uuid) } : {}),
    ...(row.proxy_saved_at ? { proxySavedAt: new Date(String(row.proxy_saved_at)).toISOString() } : {}),
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() };
}
