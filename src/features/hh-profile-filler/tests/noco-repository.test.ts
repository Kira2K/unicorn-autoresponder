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
  const reads = new Map<string, number>()
  const repository = createProfileFillerNocoRepository({
    async fetchRecords(tableId: string) {
      reads.set(tableId, (reads.get(tableId) ?? 0) + 1)
      return records[tableId] ?? []
    }
  })
  await repository.listClients(true)
  const resolved = await repository.resolveClient(7, 'En')
  await repository.resolveClient(7, 'En')
  assert.equal(resolved.stack, 'FullStack')
  assert.equal(resolved.dolphinProfileId, 123)
  assert.equal(resolved.contacts.email, 'login@example.com')
  assert.equal(resolved.contacts.phone, '+123')
  assert.equal(resolved.contacts.telegram, '@nick')
  assert.equal(resolved.credentials.login, 'login@example.com')
  assert.equal(reads.get(TABLES.clients.id), 1)
  for (const tableId of [TABLES.hhAutoresponses.id, TABLES.dolphinProfiles.id,
    TABLES.platformAccounts.id, TABLES.cvProcessing.id, TABLES.stacks.id]) {
    assert.equal(reads.get(tableId), 1)
  }

  const rateLimitedRepository = createProfileFillerNocoRepository({
    async fetchRecords() {
      const error: any = new Error('Request failed with status code 429')
      error.response = { status: 429, headers: { 'retry-after': '2' } }
      throw error
    }
  })
  await assert.rejects(rateLimitedRepository.listClients(true), (error: any) => {
    assert.equal(error.code, 'profile_noco_rate_limited')
    assert.equal(error.stage, 'resolve_noco')
    assert.equal(error.details.retryAfterMs, 2000)
    return true
  })
}
