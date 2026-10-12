import type { Candidate,Position } from '../types.ts'

export function basicFit(position: Position, candidate: Candidate): Position['fit'] {
  const title = position.title.toLowerCase().replace(/[-\s]/g, '')
  if (candidate.criteria.excludedTitles?.some(t => title.includes(t.toLowerCase().replace(/[-\s]/g, '')))) return { decision: 'excluded', reasons: ['Excluded title'], evidence: [position.title] }
  if (candidate.criteria.seniorOnly && /\b(junior|intern|graduate|principal|staff|lead|manager|head)\b/i.test(position.title) && !/\bsenior\b/i.test(position.title)) return { decision: 'excluded', reasons: ['Wrong seniority'], evidence: [position.title] }
  if (!candidate.criteria.titles.some(t => title.includes(t.toLowerCase().replace(/[-\s]/g, ''))) && !/softwareengineer|softwaredeveloper/.test(title)) return { decision: 'excluded', reasons: ['Role outside requested titles'], evidence: [position.title] }
  if (!position.description.trim()) return { decision: 'review', reasons: ['Description unavailable'], evidence: [] }
  return { decision: 'review', reasons: ['Check responsibilities, seniority, required stack, location and language against candidate facts'], evidence: [] }
}
