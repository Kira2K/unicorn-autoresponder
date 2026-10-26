import type { CvExperience } from './types.ts'
import { profileFillerError } from './errors.ts'

function unavailable(): never {
  throw profileFillerError('profile_legend_birth_date_unavailable',
    'Cannot calculate the legend birth date: every CV job needs a valid, non-future start date and the resulting age must not exceed 100 years.',
    'prepare_profile')
}

function startDate(value?: string): Date {
  const text = String(value ?? '').trim()
  const iso = text.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/)
  const full = text.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  const monthYear = text.match(/^(\d{1,2})[./](\d{4})$/)
  const year = Number(iso?.[1] ?? full?.[3] ?? monthYear?.[2])
  const month = Number(iso ? iso[2] ?? 1 : full?.[2] ?? monthYear?.[1])
  const day = Number(iso ? iso[3] ?? 1 : full?.[1] ?? 1)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (!Number.isInteger(year) || year < 1918 ||
      date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return unavailable()
  }
  return date
}

/** Estimate birth at age 18 on the earliest CV job; never read or write database fields. */
export function calculateLegendBirthDate(experience: readonly Pick<CvExperience, 'startDate'>[], today: Date): string {
  if (!experience.length || !Number.isFinite(today.getTime())) return unavailable()
  const dates = experience.map(item => startDate(item.startDate))
  if (dates.some(date => date > today)) return unavailable()
  const earliest = new Date(Math.min(...dates.map(date => date.getTime())))
  const year = earliest.getUTCFullYear() - 18
  const month = earliest.getUTCMonth()
  // February 29 becomes February 28 when the estimated birth year is not a leap year.
  const day = Math.min(earliest.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())
  const birth = new Date(Date.UTC(year, month, day))
  let age = today.getUTCFullYear() - year
  if (today.getUTCMonth() < month || (today.getUTCMonth() === month && today.getUTCDate() < day)) age--
  if (age > 100) return unavailable()
  return birth.toISOString().slice(0, 10)
}
