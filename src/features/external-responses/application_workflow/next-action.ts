import type { ApplicationRecord, Field } from '../types.ts'
import type { TailoringState } from './tailoring-status.ts'

export function missingField(field: Field) {
  return { key: field.key, label: field.label, type: field.type, required: field.required, options: field.options }
}

/** Advisory checkpoint action only; live eligibility and submission gates remain authoritative. */
export function nextApplicationAction(record: ApplicationRecord | undefined, options: {
  rulesCompatible: boolean; campaign?: unknown; review?: { result: string; sha256: string }; tailoring?: TailoringState; cvMode?: 'original'; originalCvAllowed?: boolean
}) {
  if (!record) return options.rulesCompatible ? 'prepare' : 'revalidate_saved_description'
  if (record.status === 'succeeded' || record.status === 'skipped') return 'none'
  if (record.attempt > 0 || record.status === 'submitting' || record.status === 'unknown') return 'reconcile_existing_attempt'
  if (!options.rulesCompatible) return 'revalidate_saved_description'
  if (record.status === 'failed' || record.status === 'blocked' && record.reason && record.reason !== 'input_required') return 'resolve_blocker'
  if (!record.answers || record.answers.missing.length) return 'prepare_changed_answers'
  if (record.status === 'blocked' && record.reason === 'input_required' && !record.detail.includes('tailored CV is required') && !record.detail.startsWith('test_cv_review_')) return 'resolve_blocker'
  if (options.cvMode === 'original') return options.originalCvAllowed ? 'apply_original_cv' : 'resolve_attachment_mode'
  if (!record.preparedCv) {
    if (options.tailoring?.hasResult || options.tailoring?.hasArtifact) return 'recover_tailoring_result'
    if (options.tailoring?.requests === 1) return 'resolve_tailoring_failure'
    return 'tailor_once'
  }
  if (options.campaign && (options.review?.result !== 'passed' || options.review.sha256 !== record.preparedCv.sha256)) return 'review_saved_pdf'
  return record.status === 'prepared' ? 'apply_saved_artifact' : 'resolve_blocker'
}
