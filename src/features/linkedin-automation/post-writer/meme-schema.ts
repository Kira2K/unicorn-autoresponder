const text = { type: 'string', minLength: 1, maxLength: 12000 }
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false })
export const memeSchema = object({
  status: { type: 'string', enum: ['ready', 'blocked'] }, reason: { type: 'string' },
  concept: { anyOf: [object({ postAnchor: text, scene: text, style: text,
    captionLines: { type: 'array', maxItems: 2, items: text }, prompt: text, altText: text }),
  { type: 'null' }] }
})
