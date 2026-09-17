import { createRequire } from 'node:module';
import type { WebConsoleRepository } from '../types.ts';
import { tableIds } from './tables.mts';
const { createWebConsoleRepository, normalizeId } = createRequire(import.meta.url)('../repository.ts') as {
  createWebConsoleRepository(options: { nocoClient: unknown }): WebConsoleRepository;
  normalizeId(value: unknown): string;
};
type Port = Record<string, (...args: unknown[]) => Promise<unknown>>;
export function selectedClientReads(port: Port): Pick<WebConsoleRepository,
  'getLatestClientDashboard' | 'getClientById' | 'findClientByTelegramChatId' |
  'getResumeWorkflowByTelegramChatId' | 'updateGoogleFolderByTelegramChatId'> {
  const selected = (clientId: number) => createWebConsoleRepository({ nocoClient: { ...port,
    fetchRecords(id: string, size?: number, query?: { where?: string }) {
      const field = id === tableIds.clients ? 'Id' : id === tableIds.cv ? 'clients_id' : undefined;
      return port.fetchRecords(id, size, field && !query?.where ? { ...query, where: `(${field},eq,${clientId})` } : query);
    }
  } });
  async function owner(chat: string) {
    const normalized = normalizeId(chat); if (!normalized) return undefined;
    // Scan unhydrated references to preserve the old decimal/scientific-ID normalization and first-match rule.
    const rows = await port.fetchClientReferences() as Array<{ Id: number; chat: unknown }>;
    return rows.find(row => normalizeId(row.chat) === normalized)?.Id;
  }
  return {
    async getLatestClientDashboard(options) {
      // Select IDs first: loading every student's relations is unnecessary for one dashboard.
      const rows = await port.fetchRecords(tableIds.clients, 100, { fields: 'Id', sort: 'Id' }) as Array<{ Id: number }>;
      const latest = rows.at(-1);
      if (!latest) throw new Error('No clients found');
      return selected(latest.Id).getClientDashboard(latest.Id, options);
    },
    getClientById: id => selected(id).getClientById(id),
    async findClientByTelegramChatId(chat) {
      const id = await owner(chat); return id === undefined ? null : selected(id).findClientByTelegramChatId(chat);
    },
    async getResumeWorkflowByTelegramChatId(chat, options) {
      const id = await owner(chat); return id === undefined ? null : selected(id).getResumeWorkflowByTelegramChatId(chat, options);
    },
    async updateGoogleFolderByTelegramChatId(chat, folder) {
      const id = await owner(chat); return id === undefined ? null : selected(id).updateGoogleFolderByTelegramChatId(chat, folder);
    }
  };
}
