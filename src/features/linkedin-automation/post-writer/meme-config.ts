export function memeConfig(env: Record<string, string | undefined>) {
  const apiKey = [env.OPENAI_LINKEDIN_MEME_API_KEY, env.OPENAI_LINKEDIN_POST_API_KEY,
    env.OPENAI_LINKEDIN_PROFILE_API_KEY].map(value => value?.trim()).find(Boolean) || ''
  return { enabled: env.LINKEDIN_POST_MEMES_ENABLED === 'true', apiKey,
    model: env.OPENAI_LINKEDIN_MEME_IMAGE_MODEL ?? '' }
}
