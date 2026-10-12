import type {Source,PageDocument} from '../types.ts'
import {isLinkedInUrl} from '../infrastructure/navigation-policy.ts'

/** One same-origin homepage read for an explicitly dead custom listing; never guess company domains. */
export function sourceRecoveryEntry(source:Source,pages:PageDocument[]):string|undefined {
  const url=new URL(source.url)
  if(isLinkedInUrl(url.href)||url.username||url.password||!/^https?:$/.test(url.protocol))return
  // Multi-employer platforms cannot establish this company's official homepage.
  if(/(?:^|\.)(?:lever\.co|ashbyhq\.com|greenhouse\.io|smartrecruiters\.com|workable\.com|notion\.site)$/.test(url.hostname))return
  if(!/\/(?:careers?|jobs?|vacancies|open-positions|work-with-us)\/?$/i.test(url.pathname))return
  const entry=pages.find(p=>p.url.replace(/\/$/,'')===url.href.replace(/\/$/,''))
  if(!entry||entry.accessGate||entry.jobs.length||!/^Official URL returned HTTP (?:404|410)$/.test(entry.closedEvidence??''))return
  return url.origin+'/'
}
