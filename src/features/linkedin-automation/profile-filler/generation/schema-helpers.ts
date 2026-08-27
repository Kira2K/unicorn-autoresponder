export const nullableString = { type: ['string', 'null'] }
export const stringList = { type: 'array', items: { type: 'string' } }
export const yearMonth = {
  anyOf: [
    { type: 'string', pattern: '^(?:19|20|21)[0-9]{2}-(?:0[1-9]|1[0-2])$' },
    { type: 'null' }
  ]
}
export function strictObject(properties: Record<string, unknown>) {
  return {
    type: 'object', additionalProperties: false,
    properties, required: Object.keys(properties)
  }
}

export const nullableWorkplace = {
  anyOf: [
    { type: 'string', enum: ['ON_SITE', 'HYBRID', 'REMOTE'] },
    { type: 'null' }
  ]
}
