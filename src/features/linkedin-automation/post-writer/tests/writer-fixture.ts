import { mockContext, mockDraft } from '../mock-content.ts'
import type { WriterModel } from '../writer-types.ts'

export function writerFixture() {
  const calls = { topics: 0, draft: 0 }
  const model: WriterModel = {
    async topics() {
      calls.topics++
      return { topics: ['errors', 'reviews', 'boundaries'].map((signature, i) =>
        ({ title: signature, signature, factIds: ['fact_1'], score: 90 - i })) }
    },
    async draft() { calls.draft++; return structuredClone(mockDraft) }
  }
  return { model, calls, input: { context: structuredClone(mockContext), history: [] } }
}
