import { createPostWriterService } from './service.ts'
import { createMemoryPostStore } from './memory-store.ts'
import { mockContext, mockDraft } from './mock-content.ts'
import type { Account, Dependencies, Gate, ProviderPost } from './types.ts'
import { createCvFiles } from './cv-files.ts'
import { memoryJsonFiles } from './memory-json-files.ts'
import { createMockMemes } from './meme-mock.ts'
export function createMockDependencies(gate: Gate): Dependencies {
  const accounts: Account[] = Array.from({ length: 8 }, (_, index) => ({
    platformAccountId: index ? 900 + index : 203, clientName: index ? `Mock student ${index}` : 'Test Client',
    unipileAccountId: `acc_post_mock_${index}`, verifiedProviderId: `mock_person_${index}`,
    linkedinUrl: 'https://www.linkedin.com/in/mock-student/' }))
  const posts = new Map<string, ProviderPost>()
  const reactions = new Set<string>()
  return { store: createMemoryPostStore(), gate, writable: true, writerId: 'mock-writer', mock: true,
    now: Date.now, random: Math.random, log() {}, memes: createMockMemes(), source: {
      ...createCvFiles(memoryJsonFiles(), async () => structuredClone(mockContext)),
      async accounts() { return accounts }, async context() { return structuredClone(mockContext) }
    }, generator: {
      async topics() { return { topics: ['error boundaries', 'review focus', 'caller context'].map(
        (signature, index) => ({ title: signature, signature, factIds: ['fact_1'], score: 90 - index })) } },
      async draft() { return structuredClone(mockDraft) },
      async review(_context, input) {
        const text = `${input.topic.title} ${input.text ?? ''}`.toLowerCase()
        return { allowed: !input.rules.forbiddenTopics?.some(rule => text.includes(rule.toLowerCase())),
          uncertain: false, onTopic: true }
      }
    }, adapter: {
      async identity() {},
      async publish(account, text, image) {
        const id = `mock-post-${posts.size + 1}`
        const post = { id, text, authorId: account.verifiedProviderId,
          images: image ? [{ id: `${id}-image`, available: true, width: 1024, height: 1280 }] : [],
          url: `https://www.linkedin.com/feed/update/${id}/`, createdAt: Date.now() }
        posts.set(id, post)
        return post
      },
      async read(_account, id) { const post = posts.get(id); if (!post) throw new Error('missing'); return post },
      async recent() { return [...posts.values()] },
      async reacted(account, id) { return reactions.has(`${account.verifiedProviderId}:${id}`) },
      async like(account, id) { reactions.add(`${account.verifiedProviderId}:${id}`) }
    } }
}
export const createMockPostWriter = (gate: Gate) => createPostWriterService(createMockDependencies(gate))
