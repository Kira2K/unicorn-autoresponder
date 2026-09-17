import { createRequire } from 'node:module';
import type { SqlFeatureProviders } from './feature-providers.mts';
import { fixture as inviterFixture } from '../../../linkedin-automation/connection-inviter/tests/fixtures.ts';
import { createMockDependencies } from '../../../linkedin-automation/post-writer/mock.ts';
import { mockContext } from '../../../linkedin-automation/post-writer/mock-content.ts';
import { memoryJsonFiles } from '../../../linkedin-automation/post-writer/memory-json-files.ts';
const require = createRequire(import.meta.url);
const { emptyFacts, generatedDocument } = require('../../../linkedin-automation/profile-filler/tests/generation-fixture.ts') as
  typeof import('../../../linkedin-automation/profile-filler/tests/generation-fixture.ts');
const { noWait } = require('../../../linkedin-automation/profile-filler/tests/stability-fixtures.ts') as
  typeof import('../../../linkedin-automation/profile-filler/tests/stability-fixtures.ts');
export function featureTestProviders() {
  let now = new Date('2026-09-13T10:00:00Z'), patches = 0, extracts = 0, publishes = 0, likes = 0;
  const post = createMockDependencies({ acquire: () => () => {} }), inviter = inviterFixture({ stack: 'Go' });
  const own = { public_identifier: 'sql-test', provider_id: 'provider-1', name: 'SQL fixture',
    profile_url: 'https://www.linkedin.com/in/sql-test/', connections_count: 300,
    specifics: { experience: [], education: [], skills: [] }, description: '', bio: '' };
  const identity = async () => ({ provider: 'linkedin', status: 'running', is_locked: false, user_id: 'provider-1' });
  const providers: SqlFeatureProviders = {
    auth: async () => ({ status: 'succeeded' }),
    profile: { client: { getAccount: identity, getOwnProfile: async () => structuredClone(own),
      async updateOwnProfile(_id, payload) { patches++;
        const value = payload as { specifics?: { linkedin?: { headline?: string } } };
        if (value.specifics?.linkedin?.headline !== undefined) own.description = value.specifics.linkedin.headline;
        return { accepted: true }; },
      searchParameters: async (_id, _type, keywords) => [{ id: keywords, name: keywords }] },
      executorOptions: { timing: noWait, wait: async () => {}, logger: { event() {} } },
      runtime: { config: { model: 'mock-model' }, loadProfile: async () => ({ proxy: {} }), resolveCountry: async () => 'Poland',
        loadCv: async () => ({ bytes: Buffer.from('mock'), fileName: 'cv.pdf', mimeType: 'application/pdf', revision: 'fixture-1' }),
        generator: { extractFacts: async () => structuredClone(emptyFacts), generateProfile: async () => generatedDocument() } } },
    comments: { adapter: { getAccount: identity, getOwnProfile: async () => structuredClone(own),
      listPosts: async () => ({ items: [{ id: 'fake-post', text: 'SQL test', created_at: '2026-09-13T10:00:00Z' }] }),
      listComments: async () => ({ items: [] }), listReplies: async () => ({ items: [] }),
      reply: async () => { throw Error('unexpected reply'); } },
      openai: { model: 'fake', generate: async () => { throw Error('unexpected comment generation'); } }, sleep: async () => {}, random: () => 0 },
    inviter: { adapter: { ...inviter.adapter, getAccount: identity, getOwnProfile: async () => structuredClone(own) },
      now: () => new Date(now), sleep: async ms => { now = new Date(+now + ms); }, random: () => 0, logger: { event() {} } },
    posts: { generator: post.generator, adapter: { ...post.adapter,
      async publish(...args) { publishes++; const result = await post.adapter.publish(...args); result.createdAt = +now; return result; },
      async like(...args) { likes++; await post.adapter.like(...args); } }, memes: post.memes, now: () => +now, random: () => 0,
      log() {}, files: memoryJsonFiles(), cv: { loadCv: async () => ({ bytes: Buffer.from('mock'), mimeType: 'application/pdf', revision: 'fixture-1' }),
        extractFacts: async () => { extracts++; return structuredClone(mockContext); } } }
  };
  return { providers, advance(ms: number) { now = new Date(+now + ms); },
    metrics: { get patches() { return patches; }, get extracts() { return extracts; },
      get publishes() { return publishes; }, get likes() { return likes; } } };
}
