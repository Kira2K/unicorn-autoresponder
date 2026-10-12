import { TABLES } from '../infrastructure/database.ts'
import type { DatabaseRead } from '../infrastructure/database.ts'
import { relation } from '../../../integrations/postgres/working-relations.mts'
import { readPolicies } from '../../company-client-management/restrictions/read.mts'
import type { EligibilityStudent } from './student-context.ts'
import type { Restriction, RestrictionPolicy, RestrictionSet } from './restrictions.ts'

/** Read the shared restriction source selected by the explicit storage cutover. */
export function createPostgresRestrictionPolicy(options: {
  read: DatabaseRead; evaluate?: RestrictionPolicy['evaluate']; market: 'ru' | 'en'
  expectedStack: { databaseId: string; description?: string }
}): RestrictionPolicy {
  return { evaluate: options.evaluate, load: async (candidate: EligibilityStudent): Promise<RestrictionSet> => {
    if (!candidate.databaseClientId) throw Error('database_student_binding_required')
    return options.read(async (session, catalog, reader) => {
      const studentId = candidate.databaseClientId!, clients = catalog.get(TABLES.clients.id)
      const client = await reader.getRecord(clients.id, [studentId])
      if (!client) throw Error('database_student_missing')
      const stackLink = clients.columns.find(c => c.title === 'rel_clients_primary_stack')
      if (!stackLink) throw Error('student_stack_relation_required')
      const stackRelation = relation(catalog, clients.id, stackLink.id)
      if (String(client.data[stackRelation.child.column.dataKey]) !== options.expectedStack.databaseId) throw Error('student_stack_changed')
      const stack = await reader.getRecord(TABLES.stacks.id, [options.expectedStack.databaseId])
      if (!stack || String(stack.data.stack_description ?? '').trim() !== options.expectedStack.description) throw Error('stack_description_changed')
      const rules: Restriction[] = []
      for (const row of await readPolicies(session, 'external-responses', studentId, options.market)) {
        rules.push({ id: 'company_management:' + row.id, source: row.source ?? 'noco.active_restrictions',
          instruction: row.instruction || 'This active company rule blocks or holds applications within its stored scope. Review uncertainty; respect subsidiary scope.', context: row })
      }
      // Recheck stored routing on every eligibility check, including immediately before submission.
      const reportOnly = (await session.query("SELECT id::text,name FROM noco.companies WHERE application_route='notify_only'")).rows
      for (const row of reportOnly) rules.push({ id: 'report-only:' + row.id, source: 'noco.companies.application_route', instruction: 'Do not automatically apply to this company; include it in the report only.', context: { companyId: row.id, company: row.name, applicationRoute: 'notify_only' } })
      return { studentId, complete: true, checkedAt: new Date().toISOString(), rules }
    })
  } }
}
