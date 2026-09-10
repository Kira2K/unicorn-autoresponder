import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMemeAssets } from './meme-assets.ts'
import { createMemeImageRenderer } from './meme-openai-image.ts'
import { memeConfig } from './meme-config.ts'
import { memeSchema } from './meme-schema.ts'
import type { JsonFiles } from './json-files.ts'
import type { MemeServices } from './meme-types.ts'
import type { Log } from './types.ts'
export function createMemeServices(files: JsonFiles,
  respond: (input: unknown, schema: unknown, instructions: string) => Promise<unknown>,
  log: Log, env = process.env): MemeServices {
  const document = readFileSync(resolve('src/features/linkedin-automation/post-writer/MEME_POLICY.md'), 'utf8')
  const policy = document.split('<!-- meme-prompt:start -->')[1]?.split('<!-- meme-prompt:end -->')[0]?.trim()
  if (!policy) throw new Error('meme_policy_missing')
  const config = memeConfig(env)
  const enabled = config.enabled && Boolean(config.apiKey) && config.model === 'gpt-image-2'
  return { enabled, policy, assets: createMemeAssets(files), render: createMemeImageRenderer(config, log),
    async plan(input) {
      log('meme_plan_request_started', { historyCount: input.history.length, attempt: 1 })
      return respond([{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
        memeSchema, 'You are the meme author. Return one final concept or a blocking reason. '
          + 'postAnchor must be an exact short quote from the post. For ready use reason=""; for blocked use concept=null.\n' + policy)
    } }
}
