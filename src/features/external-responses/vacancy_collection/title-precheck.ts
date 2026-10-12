import { digest } from '../../company-client-management/legacy-snapshot.mts'
import type { Position } from '../types.ts'
import type { CampaignScope } from '../stack_catalog/campaign.ts'
import type { SelectionRules } from '../stack_classification/rules.ts'
import { evaluatePublicationDate, publicationDateAudit, publicationDateConfig, publicationDatePolicyHash } from './publication-date-precheck.ts'
import type { PublicationDateAudit, PublicationDateDecision } from './publication-date-precheck.ts'

type ConfigRule = { id:string; reason:string; applicability:'all_stacks'|'development_stacks_only'; pattern:string }
type Family = { id:string; pattern:string; inspectDescription?:boolean }
type RouteGroup = { id:string; rules:{pattern:string;stackIds:string[]}[] }
type Config = { version:1; developmentStackIds:string[]; rules:ConfigRule[]; families?:Family[]; routing?:RouteGroup[]; navigationPattern?:string }
export type TitlePrecheckSkip = { title:string; url:string; ruleId:string; reason:string; policyHash:string }
export type TitlePrecheckMetadata = { version:1; policyHash:string; scopeHash:string; stackIds:string[]; skipped:TitlePrecheckSkip[] }
export type TitlePrecheck = Omit<TitlePrecheckMetadata,'skipped'> & {
  evaluate(title:string,context?:'posting'|'navigation'):{decision:'continue';family?:string;inspectDescription?:boolean;candidateStackIds?:string[]}|{decision:'excluded';ruleId:string;reason:string}
  publication?: { policyHash:string; evaluate(position:Pick<Position,'description'|'publicationLabels'|'publicationDates'|'publishedAt'|'retrievedAt'>,now?:Date):PublicationDateDecision }
}

function parseConfig(rules:SelectionRules):Config {
  const match=/```title-precheck-json\s*\n([\s\S]*?)\n```/.exec(rules.text)
  if(!match)throw Error('title_precheck_configuration_required')
  let value:unknown
  try { value=JSON.parse(match[1]) } catch { throw Error('title_precheck_configuration_invalid') }
  const config=value as Config
  if(config?.version!==1||!Array.isArray(config.developmentStackIds)||!config.developmentStackIds.every(id=>typeof id==='string'&&id.trim())||!Array.isArray(config.rules)||!config.rules.length)throw Error('title_precheck_configuration_invalid')
  const ids=new Set<string>()
  for(const rule of config.rules) {
    if(!rule||typeof rule.id!=='string'||!rule.id.trim()||ids.has(rule.id)||typeof rule.reason!=='string'||!rule.reason.trim()||!['all_stacks','development_stacks_only'].includes(rule.applicability)||typeof rule.pattern!=='string'||!rule.pattern.trim())throw Error('title_precheck_configuration_invalid')
    ids.add(rule.id)
    try { new RegExp(rule.pattern,'iu') } catch { throw Error('title_precheck_configuration_invalid') }
  }
  if(config.families) {
    if(!Array.isArray(config.families)||!config.families.length)throw Error('title_family_configuration_invalid')
    const families=new Set<string>()
    for(const family of config.families) {
      if(!family.id||families.has(family.id)||!family.pattern)throw Error('title_family_configuration_invalid')
      families.add(family.id);new RegExp(family.pattern,'iu')
    }
  }
  if(config.navigationPattern)new RegExp(config.navigationPattern,'iu')
  if(config.routing) {
    if(!Array.isArray(config.routing)||!config.routing.length)throw Error('title_routing_configuration_invalid')
    for(const group of config.routing) {
      if(!group.id||!Array.isArray(group.rules)||!group.rules.length)throw Error('title_routing_configuration_invalid')
      for(const rule of group.rules) {
        if(!rule.pattern||!Array.isArray(rule.stackIds)||!rule.stackIds.every(id=>typeof id==='string'&&id.trim()))throw Error('title_routing_configuration_invalid')
        new RegExp(rule.pattern,'iu')
      }
    }
  }
  return config
}

/** Conservative title-only rejection. Full-description classification remains authoritative for retained rows. */
export function createTitlePrecheck(rules:SelectionRules,scope:Pick<CampaignScope,'stacks'>):TitlePrecheck {
  const config=parseConfig(rules),selectedStacks=scope.stacks.map(stack=>({id:stack.databaseId,name:stack.name,description:stack.description})).sort((a,b)=>a.id.localeCompare(b.id)),stackIds=selectedStacks.map(stack=>stack.id)
  const allDevelopment=stackIds.length>0&&stackIds.every(id=>config.developmentStackIds.includes(id))
  const active=config.rules.filter(rule=>rule.applicability==='all_stacks'||allDevelopment).map(rule=>({...rule,regexp:new RegExp(rule.pattern,'iu')}))
  const families=config.families?.map(f=>({...f,regexp:new RegExp(f.pattern,'iu')}))
  const navigation=config.navigationPattern?new RegExp(config.navigationPattern,'iu'):undefined
  const routing=config.routing?.map(group=>group.rules.map(rule=>({...rule,regexp:new RegExp(rule.pattern,'iu')})))
  let publication:TitlePrecheck['publication']
  try {publicationDateConfig(rules);publication={policyHash:publicationDatePolicyHash(rules),evaluate:(position,now)=>evaluatePublicationDate(position,rules,now)}}
  catch(error) {if((error as Error).message!=='publication_date_precheck_configuration_required')throw error}
  const scopeHash=digest({version:config.version,policyHash:rules.sha256,selectedStacks,allDevelopment,publicationPolicyHash:publication?.policyHash})
  return {version:1,policyHash:rules.sha256,scopeHash,stackIds,...(publication?{publication}:{}),evaluate(title,context='posting') {
    const normalized=title.replace(/\s+/g,' ').trim()
    if(context==='navigation'&&navigation?.test(normalized))return {decision:'continue'}
    for(const rule of active)if(rule.regexp.test(normalized))return {decision:'excluded',ruleId:rule.id,reason:rule.reason}
    if(families) {
      const family=families.find(f=>f.regexp.test(normalized))
      if(!family)return {decision:'excluded',ruleId:'outside_allowed_role_families',reason:'The advertised title is outside the configured role families.'}
      let candidateStackIds:string[]|undefined
      if(routing) {
        const matches=routing.map(group=>group.filter(rule=>rule.regexp.test(normalized))).find(group=>group.length)
        const allowed=new Set(matches?.flatMap(rule=>rule.stackIds)??[])
        candidateStackIds=scope.stacks.filter(stack=>allowed.has(stack.databaseId)).map(stack=>stack.id).sort()
        if(!candidateStackIds.length)return {decision:'excluded',ruleId:'no_active_stack_for_title',reason:'The advertised title has no matching stack in this campaign.'}
      }
      return {decision:'continue',family:family.id,...(family.inspectDescription?{inspectDescription:true}:{}),...(candidateStackIds?{candidateStackIds}:{})}
    }
    return {decision:'continue'}
  }}
}

/** Recompute from current rules/scope, never trust a route saved under an earlier policy. */
export function createTitleStackSelector(rules:SelectionRules,stacks:import('../stack_catalog/index.ts').StackProfile[]) {
  const precheck=/```title-precheck-json/.test(rules.text)?createTitlePrecheck(rules,{stacks:stacks.map(stack=>({...stack,databaseId:stack.id.replace(/^stack-/,''),studentIds:[]}))}):undefined
  return (title:string)=>{
    const decision=precheck?.evaluate(title)
    return decision?.decision==='excluded'?[]:decision?.candidateStackIds?stacks.filter(stack=>decision.candidateStackIds!.includes(stack.id)):stacks
  }
}

export function recordTitleRouting(position:Position,precheck?:TitlePrecheck):Position {
  if(!precheck)return position
  const decision=precheck.evaluate(position.title)
  return {...position,titleRouting:{candidateStackIds:decision.decision==='continue'?decision.candidateStackIds??[]:[],policyHash:precheck.policyHash,scopeHash:precheck.scopeHash}}
}

export function titlePrecheckPositions(positions:Position[],precheck:TitlePrecheck) {
  const kept:Position[]=[],skipped:TitlePrecheckSkip[]=[],publicationOutcomes:PublicationDateAudit[]=[]
  for(const position of positions) {
    const decision=precheck.evaluate(position.title)
    if(decision.decision==='continue') {
      const publication=precheck.publication?.evaluate(position)
      if(publication?.decision==='excluded')publicationOutcomes.push(publicationDateAudit(position,publication,precheck.publication!.policyHash))
      else { kept.push(recordTitleRouting(position,precheck));if(publication?.decision==='inspect')publicationOutcomes.push(publicationDateAudit(position,publication,precheck.publication!.policyHash)) }
    }
    else skipped.push({title:position.title,url:position.url,ruleId:decision.ruleId,reason:decision.reason,policyHash:precheck.policyHash})
  }
  return {positions:kept,skipped,publicationOutcomes}
}

export const titlePrecheckMetadata=(precheck:TitlePrecheck,skipped:TitlePrecheckSkip[]=[]):TitlePrecheckMetadata=>({version:precheck.version,policyHash:precheck.policyHash,scopeHash:precheck.scopeHash,stackIds:[...precheck.stackIds],skipped})

export function mergeTitlePrecheckSkips(precheck:TitlePrecheck,prior:TitlePrecheckMetadata|undefined,current:TitlePrecheckSkip[]) {
  const compatible=prior?.scopeHash===precheck.scopeHash?prior.skipped:[]
  return [...new Map([...compatible,...current].map(skip=>[JSON.stringify([skip.url,skip.title,skip.ruleId]),skip])).values()]
}

export function mergePublicationDateOutcomes(prior:SourceAuditPublication|undefined,current:PublicationDateAudit[],policyHash:string):SourceAuditPublication {
  const compatible=prior?.policyHash===policyHash?prior.outcomes:[]
  return {policyHash,checkedAt:new Date().toISOString(),outcomes:[...new Map([...compatible,...current].map(outcome=>[JSON.stringify([outcome.url,outcome.ruleId,outcome.asOfDate]),outcome])).values()]}
}
type SourceAuditPublication=NonNullable<import('../types.ts').SourceAudit['publicationDatePrecheck']>
