import { digest } from '../../company-client-management/legacy-snapshot.mts'
import { loadApplicationFormMemory, saveVerifiedApplicationFormMemory } from '../applications/source-memory.ts'
import type { RuntimeDatabase } from '../infrastructure/postgres.ts'
import type { ApplicationFormMemory, Position } from '../types.ts'

/** Company form observations remain separate from private student answers and collection recipes. */
export function createApplicationFormMemory(db: Pick<RuntimeDatabase, 'read' | 'write'>): ApplicationFormMemory {
  const scope = (position: Position, engine: string) => {
    const binding = (position.sources ?? [position.source]).map(s => s.database).find(s => s?.sourceId && s.companyId)
    if (!binding) throw Error('application_form_source_missing')
    return { sourceId: binding.sourceId, companyId: binding.companyId, applyUrl: position.applyUrl, engine }
  }
  return {
    async inspect(position, engine, fields) {
      const key = scope(position, engine), formSignature = digest(fields)
      const saved = await loadApplicationFormMemory(key, db.read)
      if (!saved) return 'new'
      if (saved.formSignature === formSignature) return 'known'
      return await loadApplicationFormMemory({ ...key, formSignature }, db.read) ? 'known' : 'changed'
    },
    async verified(position, engine, fields, verifiedAt) {
      await saveVerifiedApplicationFormMemory({ ...scope(position, engine), fields, formSignature: digest(fields), verifiedAt, verified: true }, db.write)
    }
  }
}
