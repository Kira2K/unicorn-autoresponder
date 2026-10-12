import type { BatchState } from '../types.ts'
import { missingField, nextApplicationAction } from './next-action.ts'

/** Human-sized stdout; the report and SQL batch retain the complete evidence. */
export function applicationOutput(batch: BatchState, report: string, verbose = false, context: { campaign?: unknown; testReviews?: Record<string, { result: string; sha256: string }>; cvMode?: 'original' } = {}) {
  return {
    batchId: batch.id,
    records: batch.records.map(r => verbose ? {
      positionId: r.position.id, status: r.status, reason: r.reason, detail: r.detail,
      fieldCount: r.fields?.length, missing: r.answers?.missing.map(f => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options })),
      cv: r.preparedCv, evidence: r.evidence,
    } : {
      positionId: r.position.id, status: r.status, reason: r.reason,
      next: nextApplicationAction(r, { rulesCompatible: true, campaign: context.campaign, review: context.testReviews?.[r.position.id] ?? r.preparedCv?.testReview,
        cvMode: context.cvMode, originalCvAllowed: batch.cvSelection?.mode === 'original' }),
      missing: r.answers?.missing.map(missingField),
      cv: batch.cvSelection?.mode === 'original' ? { mode: 'original', path: batch.cvSelection.path, sha256: batch.cvSelection.sha256 } : r.preparedCv ? { path: r.preparedCv.path, sha256: r.preparedCv.sha256 } : undefined,
    }),
    report,
  }
}
