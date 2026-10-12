import type { VacancyMarket } from '../types.ts'

/** Lightweight dominant-language evidence. Unknown/mixed bodies remain explicit; no company inference. */
export function descriptionMarket(description: string): VacancyMarket {
  const words = description.toLowerCase().match(/\p{L}+/gu) ?? []
  const russian = words.filter(word => /^[а-яё]+$/.test(word)).length
  const latin = words.filter(word => /^[a-z]+$/.test(word)).length
  const english = words.filter(word => /^(the|and|you|your|our|with|will|are|for|to|we|this|have|work)$/.test(word)).length
  const ruEvidence = words.filter(word => /^(мы|вы|для|работы|работать|командой|будете|наши|опыт|разработчика|ищем|с|и|в|на)$/.test(word)).length
  if (russian >= 8 && ruEvidence >= 2 && russian / Math.max(1, russian + latin) > 0.25) return { value: 'ru', language: 'ru', evidence: ['Russian description: ' + description.slice(0, 240)] }
  if (latin >= 8 && english >= 3 && russian / Math.max(1, russian + latin) < 0.1) return { value: 'global', language: 'en', evidence: ['English description: ' + description.slice(0, 240)] }
  return { value: 'unknown', language: 'unknown', evidence: ['Description language is not established as English or Russian.'] }
}
