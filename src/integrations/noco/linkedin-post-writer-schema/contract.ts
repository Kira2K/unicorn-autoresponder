export const columns = [
  { title: 'Id', column_name: 'Id', uidt: 'ID', dt: 'int4', pk: true, ai: true, rqd: true },
  { title: 'record_key', column_name: 'record_key', uidt: 'SingleLineText', rqd: true },
  { title: 'platform_account_id', column_name: 'platform_account_id', uidt: 'Number', rqd: true },
  { title: 'state_json', column_name: 'state_json', uidt: 'LongText', rqd: true }
]
export function schemaIssues(fields: Record<string, unknown>[]): string[] {
  return columns.flatMap(expected => {
    const field = fields.find(value => value.title === expected.title)
    if (!field) return [expected.title]
    if (field.uidt !== expected.uidt || (expected.pk && !field.pk)) return [`${expected.title}:type`]
    return []
  })
}
