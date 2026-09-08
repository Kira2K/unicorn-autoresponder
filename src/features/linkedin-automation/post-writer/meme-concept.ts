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
  const concept = c as MemeConcept
  const words = concept.captionLines.join(' ').match(/[\p{L}\p{N}]+(?:['’−-][\p{L}\p{N}]+)*/gu) ?? []
  if (words.length > 15 || /[^\x00-\x7F\u2010-\u201F\u2026]/u.test(concept.captionLines.join(' '))) {
    throw new PostError('meme_caption_invalid')
  }
  if (!input.post.includes(concept.postAnchor) || !concept.prompt.includes('4:5') ||
    !/1024\s*[x×]\s*1280/.test(concept.prompt) || !concept.prompt.includes(concept.style) ||
    concept.captionLines.some(line => !concept.prompt.includes(line)) || concept.altText.length > 300) {
    throw new PostError('meme_prompt_invalid')
  }
  if (input.history.some(item => normalized(item.scene) === normalized(concept.scene) ||
    (concept.captionLines.length > 0 && normalized(item.captionLines.join(' ')) === normalized(concept.captionLines.join(' '))))) {
    throw new PostError('meme_duplicate_concept')
  }
  return { status: 'ready', reason: '', concept: structuredClone(concept) }
}
