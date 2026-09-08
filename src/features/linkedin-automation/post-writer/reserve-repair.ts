import type { WriterCheckpoint } from './writer-types.ts'

export async function reserveRepair(state: WriterCheckpoint, checkpoint: () => Promise<void>) {
  state.repairCount++
  try {
    await checkpoint()
  } catch (error) {
    // No model call has started. Replace the unsent reservation, including any queued save.
    state.repairCount--
    try { await checkpoint() }
    catch {
      // The owner retains the replacement for recovery; never continue generation here.
    }
    throw error
  }
}
