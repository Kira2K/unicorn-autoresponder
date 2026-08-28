function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase()
}

function linkedinValue(value: any, key: string) {
  return value?.[key] ?? value?.specifics?.[key] ?? value?.specifics?.linkedin?.[key]
}

export function networkDistance(value: unknown): number | undefined {
  const text = normalized(value)
  if (text.includes('first')) return 1
  if (text.includes('second')) return 2
  if (text.includes('third')) return 3
  const match = text.match(/(?:^|[^0-9])([123])(?:[^0-9]|$)/)
  return match ? Number(match[1]) : undefined
}

export function relationBlocks(value: any): boolean {
  if (value?.pending_invitation === true || value?.is_connection === true ||
    value?.is_relationship === true) return true
  const request = normalized(linkedinValue(value, 'relation_request_status') ??
    linkedinValue(value, 'relation_request')?.status)
  if (request && !/^(?:none|no_relation|not_connected|unknown)$/.test(request)) return true
  const relation = normalized(value?.relation ?? value?.relationship ?? value?.connection_degree)
  return Boolean(relation && (networkDistance(relation) !== 2 || /pending|sent|connected/.test(relation)))
}

export function profileAllowsInvitation(profile: any): { allowed: boolean; reasonCode: string } {
  if (relationBlocks(profile)) return { allowed: false, reasonCode: 'existing_relation' }
  const distance = networkDistance(linkedinValue(profile, 'network_distance') ?? profile?.connection_degree)
  if (distance === undefined) return { allowed: false, reasonCode: 'relationship_unverified' }
  if (distance !== 2) return { allowed: false, reasonCode: 'not_second_degree' }
  return { allowed: true, reasonCode: 'preflight_ok' }
}

export function profileIsConnected(profile: any): boolean {
  if (profile?.is_connection === true || profile?.is_relationship === true) return true
  const relation = normalized(profile?.relation ?? profile?.relationship ?? profile?.connection_degree)
  return networkDistance(linkedinValue(profile, 'network_distance') ?? relation) === 1 ||
    /connected/.test(relation)
}
