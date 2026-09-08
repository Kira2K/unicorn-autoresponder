import { normalized } from './content-identity.ts'
export function similar(left: string, right: string): boolean {
  const words = (text: string) => new Set(normalized(text).toLowerCase().match(/[a-z0-9]+/g) ?? [])
  const a = words(left), b = words(right)
  if (!a.size || !b.size) return false
  let common = 0
  for (const word of a) if (b.has(word)) common++
  return common / (a.size + b.size - common) >= 0.8
}
