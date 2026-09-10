export const POST_LENGTH = { min: 900, max: 1100, target: 1000 } as const
type LengthFeedback = typeof POST_LENGTH & {
  current?: number; removeAtLeast?: number; addAtLeast?: number; changeToTarget?: number
}

export function postLength(text: string): number {
  return Array.from(text.trim()).length
}

export function lengthFeedback(previous?: string): LengthFeedback {
  if (previous === undefined) return { ...POST_LENGTH }
  const current = postLength(previous)
  return { ...POST_LENGTH, current,
    removeAtLeast: Math.max(0, current - POST_LENGTH.max),
    addAtLeast: Math.max(0, POST_LENGTH.min - current),
    changeToTarget: POST_LENGTH.target - current }
}
