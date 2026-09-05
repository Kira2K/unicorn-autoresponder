import { randomInt } from 'node:crypto'

export type DelayRange = { min: number; max: number }
type RandomInteger = (minimum: number, maximumExclusive: number) => number
export type TimingPolicy = {
  firstWrite: DelayRange
  ordinaryWrite: DelayRange
  readBack: DelayRange
  finalReadBack: DelayRange
  skillsBatch: DelayRange
  verificationScheduleSeconds?: number[]
}

export const DEFAULT_TIMING: TimingPolicy = {
  firstWrite: { min: 10, max: 30 }, ordinaryWrite: { min: 25, max: 70 },
  readBack: { min: 120, max: 180 }, finalReadBack: { min: 300, max: 300 },
  skillsBatch: { min: 60, max: 120 },
  verificationScheduleSeconds: [300, 900, 1800, 3600]
}

export function delayMilliseconds(
  range: DelayRange,
  random: RandomInteger = (minimum, maximumExclusive) => randomInt(minimum, maximumExclusive)
) {
  if (!Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min < 0 || range.max < range.min) {
    throw new Error('profile_filler_timing_invalid')
  }
  return random(range.min, range.max + 1) * 1000
}
