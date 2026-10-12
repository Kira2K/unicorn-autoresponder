import { TABLES } from '../infrastructure/database.ts'
import type { DatabaseRead } from '../infrastructure/database.ts'
export async function loadApplicationStudent(id: string, read: DatabaseRead) {
  return read(async (_session, _catalog, reader) => {
    const row = await reader.getRecord(TABLES.clients.id, [id])
    if (!row) throw Error('database_student_missing')
    const market = await reader.getRecord(TABLES.market.id, [String(row.data.market_id)])
    const value = String(market?.data.market ?? '').toLowerCase()
    if (value !== 'en' && value !== 'ru') throw Error('student_market_unconfigured')
    const profiles = (await reader.findRecords(TABLES.dolphinProfiles.id, 'clients_id', [id], { limit: 100 })).records.filter(r => String(r.data.locale).toLowerCase() === value)
    if (profiles.length !== 1) throw Error('student_dolphin_profile_ambiguous_or_missing')
    const profileId = Number(profiles[0].data.dolphin_profile_id)
    if (!Number.isSafeInteger(profileId) || profileId <= 0) throw Error('invalid_dolphin_profile_id')
    return { studentId: id, stackId: `stack-${row.data.stacks_id}`, market: value as 'en' | 'ru', profileId }
  })
}
