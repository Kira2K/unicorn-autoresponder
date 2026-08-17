import { randomInt as cryptoRandomInt } from 'node:crypto';

export type DelayRangeSeconds = {
  min: number;
  max: number;
};

export type TimingPolicy = {
  firstWrite: DelayRangeSeconds;
  ordinaryWrite: DelayRangeSeconds;
  firstReadBack: DelayRangeSeconds;
  repeatedReadBack: DelayRangeSeconds;
  skillsBatch: DelayRangeSeconds;
  apiRateLimitCushion: DelayRangeSeconds;
};

export type RandomInt = (minimum: number, maximumExclusive: number) => number;

export const DEFAULT_LINKEDIN_TIMING_POLICY: Readonly<TimingPolicy> = {
  firstWrite: { min: 10, max: 30 },
  ordinaryWrite: { min: 45, max: 120 },
  firstReadBack: { min: 7, max: 20 },
  repeatedReadBack: { min: 15, max: 45 },
  skillsBatch: { min: 60, max: 150 },
  apiRateLimitCushion: { min: 5, max: 20 },
};

export function validateDelayRange(
  name: string,
  range: DelayRangeSeconds,
): void {
  if (
    !Number.isInteger(range.min) ||
    !Number.isInteger(range.max) ||
    range.min < 0 ||
    range.max < range.min
  ) {
    throw new Error(`Invalid timing range: ${name}`);
  }
}

export function validateTimingPolicy(policy: TimingPolicy): void {
  for (const [name, range] of Object.entries(policy)) {
    validateDelayRange(name, range);
  }
}

export function randomDelayMilliseconds(
  range: DelayRangeSeconds,
  randomInt: RandomInt = cryptoRandomInt,
): number {
  validateDelayRange('delay', range);
  return randomInt(range.min, range.max + 1) * 1000;
}
