import type { Context, Draft } from './types.ts'
export const mockContext: Context = { revision: 'mock-cv-1', role: 'Backend Engineer', stack: ['Go'],
  facts: [{ id: 'fact_1', text: 'I build Go services and review error handling with my team.',
    evidence: 'Go backend services, error handling and code review.' }] }
export const mockDraft: Draft = {
  text: `A useful code review starts where the happy path ends.

I build Go services and review error handling with my team. That makes error paths a natural place to focus a review: what does the caller actually learn when something goes wrong?

An error can travel through several layers while its meaning gets less clear. A message that makes sense inside a small function may tell the caller very little about which operation failed. Adding more words does not necessarily add more useful context.

My approach is to ask a concrete question at each boundary: can the next layer decide what to do with this error? Naming the failed operation helps keep that discussion specific. It also separates useful context from details that belong inside the implementation.

The interesting part is the boundary, not the length of the message. A review can use that distinction to discuss behavior rather than wording alone.

What context makes an error actionable for the caller in your services?

#Go #Backend #CodeReview #SoftwareEngineering`,
  factIds: ['fact_1'], claims: [{ text: 'I build Go services and review error handling with my team.', factId: 'fact_1' }]
}
