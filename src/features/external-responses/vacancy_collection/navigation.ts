import { isLinkedInUrl } from '../infrastructure/navigation-policy.ts'
import { isLanguageLabel } from './language-links.ts'

/** Complete-feed ATS readers; detail pages may expose this link beside the form. */
export function isFullFeedBoard(url:string) {
  try {
    const u=new URL(url),parts=u.pathname.split('/').filter(Boolean)
    return /^(?:jobs\.ashbyhq\.com|(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io|jobs\.(?:eu\.)?lever\.co)$/.test(u.hostname)&&parts.length===1&&parts[0]!=='embed'
      || u.hostname.endsWith('.recruitee.com')&&parts.length===0
  }catch{return false}
}

/** Rank actual career navigation; employer blog mentions are not vacancy links. */
export function vacancyLinks(links: {text:string;url:string;kind?:'posting';languageAlternative?:boolean}[], pageUrl: string, sourceName?: string) {
  const base = new URL(pageUrl)
  // These public readers always fetch the whole employer feed. UI filters
  // are aliases of that feed, not additional pages or distinct employers.
  links=links.map(link=>{
    try {
      const u=new URL(link.url),parts=u.pathname.split('/').filter(Boolean)
      if (/^(?!www\.|support\.|help\.|api\.|app\.)[a-z0-9-]+\.bamboohr\.com$/i.test(u.hostname) && /^\/jobs\/embed\d*\.php$/i.test(u.pathname)) {
        return {...link,url:u.origin+'/careers',kind:undefined}
      }
      if (/^(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io$/.test(u.hostname)&&parts[0]==='embed'&&/^[a-zA-Z0-9_-]+$/.test(u.searchParams.get('for')??'')) {
        return {...link,url:u.origin+'/'+u.searchParams.get('for'),kind:undefined}
      }
      if (/^(?:jobs\.(?:eu\.)?lever\.co|jobs\.ashbyhq\.com)$/.test(u.hostname)&&parts.length===1) {
        u.search='';u.hash='';u.pathname='/'+parts[0]
        return {...link,url:u.href}
      }
    }catch{}
    return link
  })
  // A careers page can advertise sister companies. Explicitly named employers
  // stay inside the frozen source, including before deriving ATS feeds.
  const normalizeName=(name:string)=>name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
  links=links.filter(link=>{
    const employer=link.text.trim().split(/\r?\n/)[0].match(/^(?:openings|careers|jobs|(?:job )?opportunities)\s+(?:at|with)\s+(.+?)\s*$/i)?.[1]
    const namedCareer=link.text.trim().match(/^(.+?)\s+careers$/i)?.[1]
    return (!sourceName || !employer || normalizeName(employer)===normalizeName(sourceName)) && (!sourceName || !namedCareer || /^(?:our|view|explore|all)$/i.test(namedCareer) || normalizeName(namedCareer)===normalizeName(sourceName))
  })
  // An observed official ATS posting also identifies its public employer board.
  // Prefer that existing complete-feed reader over traversing language/filter copies.
  const boards=new Map<string,{text:string;url:string;kind?:'posting';languageAlternative?:boolean}>()
  for(const link of links)try {
    const u=new URL(link.url),parts=u.pathname.split('/').filter(Boolean)
    if((/^(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io$/.test(u.hostname)&&parts[1]==='jobs'&&parts[2]) || (/^jobs\.(?:eu\.)?lever\.co$|^jobs\.ashbyhq\.com$/.test(u.hostname)&&parts.length===2)) {
      const url=u.origin+'/'+parts[0];boards.set(url,{text:'Official employer job board',url})
    }
  }catch{}
  const ranked = [...boards.values(),...links].flatMap(link => {
    if (/^(?:apply(?: now| for (?:this|the) (?:job|role))?|submit application|send application|откликнуться)$/i.test(link.text.trim())) return []
    let u: URL
    try { u = new URL(link.url) } catch { return [] }
    if (!/^https?:$/.test(u.protocol) || isLinkedInUrl(u.href)) return []
    // Skip a language switch only when its destination is the same route/query.
    // Country sections and different job paths are not language aliases.
    const withoutLocale=(path:string)=>path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i,'').replace(/\/$/,'')
    if (u.hostname===base.hostname && (link.languageAlternative || isLanguageLabel(link.text,u.pathname)) && withoutLocale(u.pathname)===withoutLocale(base.pathname) && u.search===base.search) return []
    if (/^(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io$/.test(u.hostname)&&u.pathname.split('/')[1]==='embed') return []
    if (/\.pdf$/i.test(u.pathname)&&/privacy[\s_-]+(?:policy|notice|statement)|cookie[\s_-]+policy|recruit(?:ing|ment)[\s_-]+(?:scams?|fraud)|warnings?[\s_-]+about[\s_-]+recru/i.test(link.text+' '+u.pathname)) return []
    // Exact informational routes, not similarly named vacancy slugs.
    if (/\/careers?\/(?:about|training|career-path|privacy-cookies-policy|diversity|future-talent|sustainability|how-we-hire)\/?$/i.test(u.pathname)&&link.kind!=='posting') return []
    // Powered-by links advertise the ATS vendor, not this employer's job board.
    if (/^(?:(?:www|support|help|api|app)\.)?teamtailor\.com$/i.test(u.hostname)) return []
    if (u.hostname === 'career.teamtailor.com' && base.hostname !== u.hostname) return []
    if (/\/(?:cookie-policy|cookies|data-privacy|gdpr_policy)(?:\/|$)/i.test(u.pathname)) return []
    if (/^(?:(?:www\.)?(?:personio|bamboohr)\.com|jobs\.workable\.com)$/i.test(u.hostname) && u.hostname!==base.hostname) return []
    if (/\/(?:connect|auth|oauth|oauth2|sso(?:[-_]login)?|data_request|request_removal|people|sign[-_]?in|sign[-_]?up|register)(?:\/|$)/i.test(u.pathname)) return []
    if (/(^|\.)(facebook\.com|x\.com|twitter\.com|instagram\.com|youtube\.com)$/.test(u.hostname)) return []
    if (/\/(?:blogs?|articles?|news|resources|docs|developers?|products?|customers?|stories|culture|culture-code|locations|benefits|early-careers|students?|privacy(?:-policy)?|terms(?:-and-conditions)?|refer-a-friend|contact|login|share|templates|events)(?:\/|$)/i.test(u.pathname)) return []
    const jazz=/^[a-z0-9-]+\.applytojob\.com$/i.test(u.hostname)&&!/^www\./.test(u.hostname)
    const ats = /^(?:jobs\.ashbyhq\.com|(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io|jobs\.(?:eu\.)?lever\.co|apply\.workable\.com|jobs\.smartrecruiters\.com)$/.test(u.hostname) || u.hostname.endsWith('.recruitee.com') || u.hostname.endsWith('.teamtailor.com') || jazz
    const career = /\/(?:careers?(?:[-_][a-z]+)*|jobs?|positions?|vacanc(?:y|ies)(?:-[a-z]+)?|openings?|opportunities|j|o)(?:\/|$)|work-with-us/i.test(u.pathname) || (/(?:^|\.)(?:careers?|jobs)\./i.test(u.hostname) && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/?)?$/i.test(u.pathname))
    const control = /^(?:next(?: page)?|load more|show more jobs|view jobs|view job openings|(?:see |view |all |open )?(?:job openings|open positions|open roles|careers))$/i.test(link.text.trim())
    const sameHost = u.hostname === base.hostname
    const externalCareer = !sameHost && (/^(?:careers|job openings|open positions|open roles|join (?:our|the) team)$/i.test(link.text.trim()) || !!sourceName && normalizeName(link.text)===normalizeName(sourceName+' careers'))
    const notionRole = u.hostname.endsWith('.notion.site') && /(?:engineer|developer|разработчик)/i.test(link.text) && /-[0-9a-f]{32}$/i.test(u.pathname)
    const listedRole = sameHost && (link.kind==='posting' || /\/(?:careers?|jobs?|vacancies)(?:\/|$)/i.test(base.pathname) && /\b(?:engineer|developer)\b|разработчик|QA[- ]|аналитик/i.test(link.text))
    if (!ats && !career && !externalCareer && !((control || notionRole || listedRole) && sameHost)) return []
    const detail = /\/(?:jobs?|positions?|vacancies|careers\/v)\/[^/]+\/?$/i.test(u.pathname) || jazz&&/^\/apply\/[^/]+\/[^/]+\/?$/.test(u.pathname) || notionRole || listedRole
    const filter = [...u.searchParams.keys()].some(key => /^(?:team|department|location|language)$/i.test(key))
    const score = (ats ? 100 : 0) + (ats && u.pathname.split('/').filter(Boolean).length===1 ? 120 : 0) + (detail ? 60 : 0) + (externalCareer ? 50 : 0) + (filter ? -60 : 0) + (/\/(?:jobs?|positions?|vacancies|open-positions)\/?$/i.test(u.pathname) ? 40 : 0) + (control ? 10 : 0)
    return [{link,score}]
  })
  return [...new Map(ranked.sort((a,b)=>b.score-a.score).map(item=>[item.link.url,item.link])).values()]
}
