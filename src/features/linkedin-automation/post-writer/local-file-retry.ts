import { setTimeout } from 'node:timers/promises'
// Windows antivirus/read handles may briefly deny rename/read of a private JSON file.
// Retry only an idempotent local operation; never a model or external mutation.
export async function retryLocalFile<T>(operation: () => Promise<T>,
  wait: (milliseconds: number) => Promise<unknown> = setTimeout): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 6 || (code !== 'EPERM' && code !== 'EBUSY')) throw error
      await wait(25 * (2 ** attempt))
    }
  }
}
