import { monthlyUsd } from './salary.ts'
import type { Compensation, ExchangeRates } from './salary.ts'
import type { SelectionRules } from './rules.ts'

type Input = {description:string;compensation?:Compensation}
export type SalaryCheck = {status:'not_stated'|'pass'|'excluded'|'review';reason:string;evidence:string[];normalized?:ReturnType<typeof monthlyUsd>}
const currencyPattern = '(?:USD|EUR|GBP|CAD|AUD|NZD|SGD|PLN|RUB|GEL|INR|CHF|SEK|NOK|DKK|CZK|US\\$|CA\\$|AU\\$|\\$|€|£|₽|₹)'
const numberPattern = '\\d+(?:[., \\u00a0]\\d+)*(?:\\s*[kKmM])?'
const amounts = new RegExp(`(?<before>${currencyPattern})?\\s*(?<low>${numberPattern})(?:\\s*(?:-|–|—|to|до)\\s*(?<other>${currencyPattern})?\\s*(?<high>${numberPattern}))?\\s*(?<after>${currencyPattern})?(?<plus>\\+)?`, 'giu')
const currencies:Record<string,string>={'US$':'USD','CA$':'CAD','AU$':'AUD','€':'EUR','£':'GBP','₽':'RUB','₹':'INR'}
function amount(value:string) {
  const suffix=value.match(/[kKmM]$/)?.[0],scale=suffix?.toLowerCase()==='m'?1e6:suffix?1e3:1
  let text=value.replace(/[kKmM]$/,'').trim().replace(/[ \u00a0]/g,'')
  if(/^\d{1,3}(?:[,\.]\d{3})+(?:[.,]\d{1,2})?$/.test(text)) {
    const decimal=text.match(/[.,]\d{1,2}$/)?.[0]
    text=decimal?text.slice(0,-decimal.length).replace(/[.,]/g,'')+'.'+decimal.slice(1):text.replace(/[.,]/g,'')
  } else if(/^\d+(?:[.,]\d{1,2})?$/.test(text))text=text.replace(',','.')
  else return NaN
  return Number(text)*scale
}
function parse(description:string):{pay?:Compensation;evidence:string[];reason?:string} {
  // Explicit compensation clauses only: revenue, training budgets and incidental money are not pay.
  const clauses=description.split(/\n|(?<=[.!?])\s+(?=[A-ZА-Я])/).filter(s=>/\b(?:salary|base pay|base compensation|pay range|compensation range|remuneration)\b|зарплат|заработн|оклад/iu.test(s)&&/\d/.test(s.replace(/\b\d+(?:[.,]\d+)?\s*%/g,'')))
  if(!clauses.length)return {evidence:[]}
  if(clauses.length!==1)return {evidence:clauses,reason:'Multiple salary clauses require unambiguous structured compensation'}
  const clause=clauses[0], evidence=[clause]
  const matches=[...clause.matchAll(amounts)].filter(m=>m.groups?.before||m.groups?.other||m.groups?.after)
  if(matches.length!==1)return {evidence,reason:'Salary amount or currency is missing or ambiguous'}
  const match=matches[0],g=match.groups!,codes=[g.before,g.other,g.after].filter(Boolean).map(c=>currencies[c.toUpperCase()]??c.toUpperCase())
  if(codes.includes('$')||new Set(codes).size!==1)return {evidence,reason:'Salary currency is ambiguous'}
  const periods:[RegExp,Compensation['period']][]=[[/\b(?:per year|a year|yearly|annual(?:ly)?|per annum|pa)\b|\/\s*(?:year|yr)\b|в год/iu,'year'],[/\b(?:per month|a month|monthly)\b|\/\s*(?:month|mo)\b|в месяц/iu,'month'],[/\b(?:per week|weekly)\b|\/\s*(?:week|wk)\b|в неделю/iu,'week'],[/\b(?:per hour|hourly)\b|\/\s*(?:hour|hr|h)\b|в час/iu,'hour'],[/\b(?:per day|daily)\b|\/\s*day\b|в день/iu,'day']]
  // Read the salary's unit before ancillary working-time information.
  const payClause=clause.split(';')[0],units=periods.filter(([pattern])=>pattern.test(payClause)).map(([,period])=>period)
  if(units.length!==1)return {evidence,reason:'Salary period is missing or contradictory'}
  let low=amount(g.low),high=g.high?amount(g.high):undefined
  // A shared k suffix in "24–30k" applies to both bounds.
  if(g.high&&/[kKmM]$/.test(g.high)&&!/[kKmM]$/.test(g.low)&&low<1000)low*=g.high.trim().slice(-1).toLowerCase()==='m'?1e6:1e3
  const prefix=clause.slice(0,match.index),minimum=/\b(?:from|starting at|at least|minimum)\s*$/iu.test(prefix.trim())||/от\s*$/iu.test(prefix.trim())||!!g.plus
  const maximum=/\b(?:up to|maximum)\s*$/iu.test(prefix.trim())||/до\s*$/iu.test(prefix.trim())
  if(!g.high&&!minimum){high=low;if(maximum)low=0}
  const hours=/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:per|a|\/)\s*week\b/iu.exec(description)
  const days=/\b(\d+(?:\.\d+)?)\s*days?\s*(?:per|a|\/)\s*week\b/iu.exec(description)
  return {evidence,pay:{min:low,...(high!==undefined?{max:high}:{}),currency:codes[0],period:units[0],net:/\bnet\b|after tax|на руки/iu.test(clause),...(hours?{hoursPerWeek:Number(hours[1])}:{}),...(days?{daysPerWeek:Number(days[1])}:{})}}
}
/** No I/O or AI. Missing FX/period/tax/time basis becomes explicit data review. */
export function checkSalary(position:Input,minimumGrossMonthlyUsd:number,rates?:ExchangeRates):SalaryCheck {
  const parsed=position.compensation?{pay:position.compensation,evidence:[JSON.stringify(position.compensation)]}:parse(position.description)
  if(!parsed.pay)return {status:parsed.reason?'review':'not_stated',reason:parsed.reason??'No stated salary',evidence:parsed.evidence}
  const normalized=monthlyUsd(parsed.pay,rates)
  if(normalized.status==='unknown')return {status:'review',reason:normalized.reason,evidence:parsed.evidence,normalized}
  if(parsed.pay.max===undefined)return {status:'pass',reason:'Minimum-only salary does not establish a below-floor upper bound',evidence:parsed.evidence,normalized}
  const excluded=normalized.max<minimumGrossMonthlyUsd
  return {status:excluded?'excluded':'pass',reason:excluded?'Stated salary upper bound is below the configured monthly gross USD floor':'Stated salary upper bound reaches the configured floor',evidence:parsed.evidence,normalized}
}
export function salaryFloor(rules:SelectionRules):number|undefined {
  const block=/```salary-precheck-json\s*\n([\s\S]*?)\n```/.exec(rules.text)
  if(!block)return undefined
  const config=JSON.parse(block[1])
  if(config.version!==1||!Number.isFinite(config.minimumGrossMonthlyUsd)||config.minimumGrossMonthlyUsd<=0)throw Error('salary_precheck_configuration_invalid')
  return config.minimumGrossMonthlyUsd
}

/** Only currency evidence actually used by this posting belongs in its semantic packet/cache. */
export function recordedSalaryContext(position:Input,rules:SelectionRules,rates?:ExchangeRates) {
  const floor=salaryFloor(rules)
  if(!rates||floor===undefined)return
  const salaryCheck=checkSalary(position,floor,rates),normalized=salaryCheck.normalized
  if(normalized?.status!=='normalized'||!normalized.evidence.rateSource)return
  const currency=normalized.evidence.original.currency.toUpperCase()
  return {exchangeRates:{asOf:rates.asOf,source:rates.source,usdPerUnit:{[currency]:rates.usdPerUnit[currency]}},salaryCheck}
}
