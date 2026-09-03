import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createProfileFillerNocoRepository } from '../noco-repository.ts'

const require = createRequire(import.meta.url)
const { TABLES } = require('../../../integrations/noco/core/schema.ts') as {
  TABLES: Record<string, { id: string }>
}

export async function runNocoRepositoryTests() {
  const records: Record<string, any[]> = {
    [TABLES.clients.id]: [{ Id: 7, client_name: 'Client', client_status: 'on en market',
      fio: 'Fallback Name', birth_date: '1990-01-01', desired_location: 'Anywhere',
      rel_clients_primary_stack: { Id: 1, name: 'Python' } }],
    [TABLES.hhAutoresponses.id]: [{ Id: 70, clients_id: 7,
      'Stack Override': { Id: 2, name: 'FullStack' } }],
    [TABLES.dolphinProfiles.id]: [{ Id: 71, clients_id: 7, locale: 'en',
      dolphin_profile_id: '123' }],
    [TABLES.platformAccounts.id]: [
      { Id: 72, clients_id: 7, platforms_id: 10, account_label: 'Client hh_en',
        login: 'login@example.com', password: 'secret' },
      { Id: 73, clients_id: 7, platforms_id: 27, account_label: 'Client email_en',
        login: 'contact@example.com' },
      { Id: 74, clients_id: 7, platforms_id: 28, account_label: 'phone_en', login: '+123' },
      { Id: 75, clients_id: 7, platforms_id: 23, account_label: 'telegram en', nickname: '@nick' }
    ],
    [TABLES.cvProcessing.id]: [{ Id: 76, clients_id: 7, status: 'moved to filling',
      en_version_url: 'https://docs.google.com/document/d/cv', UpdatedAt: '2026-09-01' }],
    [TABLES.stacks.id]: [{ Id: 1, name: 'Python' }, { Id: 2, name: 'FullStack' }]
  }
  const repository = createProfileFillerNocoRepository({
    async fetchRecords(tableId: string) { return records[tableId] ?? [] }
  })
  const resolved = await repository.resolveClient(7, 'En')
  assert.equal(resolved.stack, 'FullStack')
  assert.equal(resolved.dolphinProfileId, 123)
  assert.equal(resolved.contacts.email, 'login@example.com')
  assert.equal(resolved.contacts.phone, '+123')
  assert.equal(resolved.contacts.telegram, '@nick')
  assert.equal(resolved.credentials.login, 'login@example.com')
}
