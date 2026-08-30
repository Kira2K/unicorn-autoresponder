import type { ConnectionLocationResolution } from './types.ts'

const ALIASES: Record<string, string[]> = {
  'washington dc': ['washington, district of columbia', 'washington d.c.'],
  bangalore: ['bengaluru'],
  kyiv: ['kiev']
}

function normalized(value: unknown) {
  return String(value ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('und').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function locationId(value: any) {
  return String(value?.id ?? value?.provider_id ?? value?.value ?? '').trim()
}

function locationLabel(value: any) {
  return String(value?.name ?? value?.label ?? value?.title ?? value?.display_name ?? '').trim()
}

export function selectLocation(city: string, rows: any[], resolvedAt: string): ConnectionLocationResolution {
  const target = normalized(city)
  const accepted = new Set([target, ...(ALIASES[target] ?? []).map(normalized)])
  const candidates = rows.map(row => ({ row, id: locationId(row), label: locationLabel(row) }))
    .filter(item => item.id && item.label)
  const exact = candidates.filter(item => accepted.has(normalized(item.label)))
  const fuzzy = candidates.filter(item => {
    const label = normalized(item.label)
    return [...accepted].some(value => label.startsWith(`${value} `) || value.startsWith(`${label} `))
  })
  const selected = exact.length === 1 ? exact[0] : exact.length ? undefined :
    fuzzy.length === 1 ? fuzzy[0] : undefined
  return selected
    ? { status: 'resolved', city, id: selected.id, label: selected.label, resolvedAt }
    : { status: 'unresolved', city, resolvedAt }
}
