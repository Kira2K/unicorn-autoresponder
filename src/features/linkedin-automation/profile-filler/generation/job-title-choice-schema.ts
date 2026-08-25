import { strictObject } from './schema-helpers.ts'

export const JOB_TITLE_CHOICE_SCHEMA = strictObject({
  choices: {
    type: 'array', maxItems: 5,
    items: strictObject({
      index: { type: 'integer', minimum: 0, maximum: 4 },
      candidate_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      confident: { type: 'boolean' }
    })
  }
})
