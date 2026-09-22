// Pure planning: no timers, storage or feature calls. A slot owns one ordered
// sequence; spare time is shared by the leading, intermediate and trailing gaps.
export const minimumTaskPauseMs = 5_000
export function planSlotTasks(start: number, end: number, now: number,
  tasks: Array<{ key: string; reserveMs: number }>, random: () => number) {
  const earliest = Math.max(start, now)
  let available = end - earliest
  const selected: typeof tasks = []
  for (const task of tasks) {
    const cost = task.reserveMs + (selected.length ? minimumTaskPauseMs : 0)
    if (cost > available) continue
    selected.push(task); available -= cost
  }
  const result = new Map<string, { plannedAt: number; pauseBeforeMs: number }>()
  if (!selected.length) return result
  const weights = Array.from({length:selected.length+1},()=>Math.max(0,Math.min(.999999,random())))
  let total = weights.reduce((sum, weight)=>sum+weight,0)
  if (!total) { weights[weights.length-1]=1; total=1 }
  let cursor=earliest
  for (const [index, task] of selected.entries()) {
    const pauseBeforeMs = Math.floor(available * weights[index] / total) + (index ? minimumTaskPauseMs : 0)
    cursor += pauseBeforeMs
    result.set(task.key,{plannedAt:cursor,pauseBeforeMs})
    cursor += task.reserveMs
  }
  return result
}

// Deadline is fixed when a task starts. Long runs cannot keep extending it by
// increasing the historical estimate or by restarting the backend.
export const taskTimeLimitMs = (reserveMs: number) => Math.max(reserveMs * 2, reserveMs + 30 * 60_000)
