import type { ApplicationDestination, Position } from '../types.ts'

function telegram(value: string): string | undefined {
  if (/^@[a-zA-Z][\w]{3,31}$/.test(value)) return 'https://t.me/' + value.slice(1)
  try {
    const url = new URL(value)
    if (url.protocol === 'tg:' && url.hostname === 'resolve' && /^[a-zA-Z][\w]{3,31}$/.test(url.searchParams.get('domain') ?? '')) return 'https://t.me/' + url.searchParams.get('domain')
    if (/^https?:$/.test(url.protocol) && /^(t\.me|telegram\.me)$/.test(url.hostname) && /^\/[a-zA-Z][\w]{3,31}\/?$/.test(url.pathname)) return 'https://t.me/' + url.pathname.replace(/^\/|\/$/g, '')
  } catch {}
}
const instruction = /\bapply\b|send.{0,70}(cv|resume|résumé|application)|отклик|присыла.{0,50}резюме|отправ.{0,50}резюме|резюме.{0,40}(отправ|пиши)/i

/** Preserve explicit recipients, never infer them from footer/social links. No navigation or messages. */
export function applicationDestinations(input: Pick<Position, 'url' | 'applyUrl' | 'description'> & { applicationLinks?: { text: string; url: string }[] }): ApplicationDestination[] {
  const routes = new Map<string, ApplicationDestination>()
  const add = (value: string, evidence: string) => { const address = telegram(value); if (address) routes.set(address, { channel: 'telegram', address, evidence }) }
  add(input.applyUrl, 'Explicit application URL: ' + input.applyUrl)
  for (const link of input.applicationLinks ?? []) if (instruction.test(link.text)) add(link.url, link.text)
  for (const line of input.description.split(/\n|(?<=[.!?])\s+/)) {
    // Keep evidence local to the application instruction, not the whole page.
    for (const match of line.matchAll(/https?:\/\/(?:t\.me|telegram\.me)\/[\w]+|(?<![\w.])@[a-zA-Z][\w]{3,31}\b/g)) {
      const evidence = line.slice(Math.max(0, match.index! - 180), match.index! + match[0].length + 80)
      if (instruction.test(evidence)) add(match[0], evidence)
    }
  }
  if (routes.size && !telegram(input.applyUrl) && input.applyUrl !== input.url && /^https?:\/\//.test(input.applyUrl)) routes.set(input.applyUrl, { channel: 'web', address: input.applyUrl, evidence: 'Explicit web application URL' })
  return [...routes.values()]
}
export const telegramOnly = (position: Pick<Position, 'applicationDestinations'>) => !!position.applicationDestinations?.length && position.applicationDestinations.every(route => route.channel === 'telegram')
