import { randomInt } from 'node:crypto'

export type DelayRange = { min: number; max: number }
type RandomInteger = (minimum: number, maximumExclusive: number) => number
export type TimingPolicy = {
  firstWrite: DelayRange
  ordinaryWrite: DelayRange
  readBack: DelayRange
  repeatedReadBack: DelayRange
  finalReadBack: DelayRange
  skillsBatch: DelayRange
}

export const DEFAULT_TIMING: TimingPolicy = {
  firstWrite: { min: 10, max: 30 }, ordinaryWrite: { min: 45, max: 120 },
  readBack: { min: 15, max: 30 }, repeatedReadBack: { min: 60, max: 120 },
  finalReadBack: { min: 55, max: 65 },
  skillsBatch: { min: 60, max: 150 }
}

export const DEFAULT_VERIFICATION_ATTEMPTS = 2
export const DEFAULT_FINAL_VERIFICATION_ATTEMPTS = 2

export function delayMilliseconds(
  range: DelayRange,
  random: RandomInteger = (minimum, maximumExclusive) => randomInt(minimum, maximumExclusive)
) {
  if (!Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min < 0 || range.max < range.min) {
    throw new Error('profile_filler_timing_invalid')
  }
  return random(range.min, range.max + 1) * 1000
}
