import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memeConfig } from '../meme-config.ts'
import { createMemeServices } from '../meme-runtime.ts'
import { createMemeImageRenderer } from '../meme-openai-image.ts'
import { memoryJsonFiles } from '../memory-json-files.ts'
import { mockMemePng } from '../meme-mock.ts'

const base = { LINKEDIN_POST_MEMES_ENABLED: 'true', OPENAI_LINKEDIN_MEME_IMAGE_MODEL: 'gpt-image-2',
  OPENAI_LINKEDIN_PROFILE_API_KEY: 'fixture-profile' }
test('image key precedence: meme, post, profile; empty values use fallback', async () => {
  for (const [env, expected] of [
    [base, 'fixture-profile'],
    [{ ...base, OPENAI_LINKEDIN_POST_API_KEY: 'fixture-post' }, 'fixture-post'],
    [{ ...base, OPENAI_LINKEDIN_POST_API_KEY: 'fixture-post', OPENAI_LINKEDIN_MEME_API_KEY: 'fixture-meme' }, 'fixture-meme'],
    [{ ...base, OPENAI_LINKEDIN_POST_API_KEY: ' ', OPENAI_LINKEDIN_MEME_API_KEY: '' }, 'fixture-profile']
  ] as const) {
    let calls = 0
    const config = memeConfig(env)
    await createMemeImageRenderer(config, () => {}, async (_url, init) => {
      calls++
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${expected}`)
      return new Response(JSON.stringify({ data: [{ b64_json: mockMemePng().toString('base64') }] }))
    })('fixture prompt')
    assert.equal(calls, 1)
    assert.equal(createMemeServices(memoryJsonFiles(), async () => ({}), () => {}, env).enabled, true)
  }
})
test('fallback does not enable memes or substitute a text model for the image model', async () => {
  for (const env of [{ ...base, LINKEDIN_POST_MEMES_ENABLED: 'false' },
    { ...base, OPENAI_LINKEDIN_PROFILE_API_KEY: '' },
    { ...base, OPENAI_LINKEDIN_MEME_IMAGE_MODEL: '', OPENAI_LINKEDIN_POST_MODEL: 'fixture-text' }]) {
    const service = createMemeServices(memoryJsonFiles(), async () => ({}), () => {}, env)
    assert.equal(service.enabled, false)
    await assert.rejects(createMemeImageRenderer(memeConfig(env), () => {},
      async () => { assert.fail('disabled or missing config must not call provider') })('prompt'))
  }
})
