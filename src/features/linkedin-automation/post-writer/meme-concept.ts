import { PostError, object } from './errors.ts'
import { normalized } from './content-identity.ts'
import type { MemeInput, MemePlan, MemeConcept } from './meme-types.ts'

export function parseMemeConcept(value: unknown, input: MemeInput): MemePlan {
  const result = object(value)
  if (result.status === 'blocked' && typeof result.reason === 'string' && result.reason.trim() && result.concept === null) {
    return { status: 'blocked', reason: result.reason.slice(0, 2000), concept: null }
  }
  const c = object(result.concept)
  const keys = ['postAnchor', 'scene', 'style', 'prompt', 'altText']
  if (result.status !== 'ready' || result.reason !== '' ||
    keys.some(key => typeof c[key] !== 'string' || !c[key].trim() || c[key].length > 12000) ||
    !Array.isArray(c.captionLines) || c.captionLines.length > 2 ||
    c.captionLines.some(line => typeof line !== 'string' || !line.trim())) throw new PostError('meme_concept_invalid')
  const concept = structuredClone(c) as MemeConcept
  const words = concept.captionLines.join(' ').match(/[\p{L}\p{N}]+(?:['’−-][\p{L}\p{N}]+)*/gu) ?? []
  if (words.length > 15 || /[^\x00-\x7F\u2010-\u201F\u2026]/u.test(concept.captionLines.join(' '))) {
    throw new PostError('meme_caption_invalid')
  }
  const warnings: string[] = []
  if (!normalized(input.post).includes(normalized(concept.postAnchor))) warnings.push('meme_anchor_paraphrased')
  // Rendering requirements belong to the renderer, not an exact-string exam for the author.
  concept.prompt += `\nRendering requirements: portrait 4:5, 1024x1280. Style: ${concept.style}.\n`
    + (concept.captionLines.length ? `Exact visible text: ${JSON.stringify(concept.captionLines)}. No other lettering.` : 'No visible lettering.')
  concept.altText = Array.from(concept.altText).slice(0, 300).join('')
  if (input.history.some(item => normalized(item.scene) === normalized(concept.scene) ||
    (concept.captionLines.length > 0 && normalized(item.captionLines.join(' ')) === normalized(concept.captionLines.join(' '))))) {
    warnings.push('meme_duplicate_concept')
  }
  return { status: 'ready', reason: '', concept, ...(warnings.length ? { warnings } : {}) }
}
