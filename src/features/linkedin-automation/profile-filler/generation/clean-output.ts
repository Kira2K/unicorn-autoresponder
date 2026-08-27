export function removeNullFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeNullFields)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null)
    .map(([key, item]) => [key, removeNullFields(item)]))
}

export function finalizeGeneratedOutput(value: unknown) {
  const result = removeNullFields(value) as any
  const profile = result?.profile
  if (profile && Array.isArray(profile.about_blocks)) {
    profile.about = profile.about_blocks.map((block: unknown) => String(block).trim())
      .filter(Boolean).join('\n\n')
    delete profile.about_blocks
  }
  return result
}
