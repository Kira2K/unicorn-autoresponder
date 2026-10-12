import type { SelectionRules } from './rules.ts'

type Config={version:1;allowedCountryCodes:string[];allowedRegions:string[];excludedRegions:string[];worldwideLabels:string[];countryAliases:Record<string,string>;missingGeography?:'allow'|'review';unspecifiedLocationLabels?:string[]}
export type GeographyCheck={status:'allowed'|'excluded'|'unresolved';reason:string;evidence:string[]}
type Region='allowed'|'excluded'|'worldwide'|'unknown'
const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g,' ').trim().replace(/[.!]+$/,'')
let countryNames:Map<string,string>|undefined
function countries() {
  if(countryNames)return countryNames
  const names=new Intl.DisplayNames(['en'],{type:'region'}),result=new Map<string,string>()
  // ISO-style region names come from the runtime's CLDR data; policy stays in the skill.
  for(let a=65;a<=90;a++)for(let b=65;b<=90;b++) {
    const code=String.fromCharCode(a,b),name=names.of(code)
    if(name&&name!==code&&!['EU','UN','EZ','ZZ'].includes(code)){const canonical=new Intl.Locale('und-'+code).region!;result.set(normalize(name),canonical);result.set(code.toLowerCase(),canonical)}
  }
  countryNames=result;return result
}
function configuration(rules:SelectionRules):Config|undefined {
  const block=/```geography-precheck-json\s*\n([\s\S]*?)\n```/.exec(rules.text)
  if(!block)return undefined
  let c:Config
  try{c=JSON.parse(block[1])}catch{throw Error('geography_precheck_configuration_invalid')}
  const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.length>0&&v.every(s=>typeof s==='string'&&!!s.trim())
  if(c?.version!==1||!strings(c.allowedCountryCodes)||c.allowedCountryCodes.some(s=>!/^[A-Z]{2}$/.test(s))||!strings(c.allowedRegions)||!strings(c.excludedRegions)||!strings(c.worldwideLabels)||!c.countryAliases||typeof c.countryAliases!=='object'||Array.isArray(c.countryAliases)||Object.entries(c.countryAliases).some(([alias,code])=>!alias.trim()||typeof code!=='string'||!/^[A-Z]{2}$/.test(code)))throw Error('geography_precheck_configuration_invalid')
  if(c.missingGeography!==undefined&&!['allow','review'].includes(c.missingGeography)||c.unspecifiedLocationLabels!==undefined&&!strings(c.unspecifiedLocationLabels))throw Error('geography_precheck_configuration_invalid')
  return c
}

/** Pure policy gate. Missing geography follows the skill; actual unresolved restrictions remain review. */
export function createGeographyPrecheck(rules:SelectionRules):((p:{location:string;description:string})=>GeographyCheck)|undefined {
  const config=configuration(rules);if(!config)return undefined
  const allowed=new Set(config.allowedCountryCodes),names=new Map(countries())
  const unspecifiedLabels=new Set((config.unspecifiedLocationLabels??[]).map(normalize))
  for(const [alias,code] of Object.entries(config.countryAliases))names.set(normalize(alias),code)
  const areas=new Map<string,Region>([...config.allowedRegions.map(s=>[normalize(s),'allowed'] as const),...config.excludedRegions.map(s=>[normalize(s),'excluded'] as const),...config.worldwideLabels.map(s=>[normalize(s),'worldwide'] as const)])
  const token=(s:string):Region=>{const value=normalize(s).replace(/^the /,''),area=areas.get(value);if(area)return area;const country=names.get(value);return country?allowed.has(country)?'allowed':'excluded':'unknown'}
  const resolve=(raw:string):Region=>{
    if(/\b(?:not|except|excluding|outside|unless)\b/i.test(raw))return 'unknown'
    const text=normalize(raw).replace(/\b(?:fully|remote|hybrid|on[ -]?site|office|work|working|from|based in|located in|only)\b/g,' ').replace(/[()]/g,' ').replace(/\s+/g,' ').trim().replace(/^[-–—:, ]+|[-–—:, ]+$/g,'')
    const direct=token(text);if(direct!=='unknown')return direct
    const parts=text.split(/\s*(?:[\/|;]|\bor\b|\band\b)\s*/).filter(Boolean)
    const values=parts.map(part=>{
      const direct=token(part);if(direct!=='unknown')return direct
      const comma=part.split(',').map(s=>s.trim()).filter(Boolean),known=comma.map(token)
      if(comma.length>1&&/^[a-z]{2}$/.test(comma.at(-1)!)&&!comma.every(s=>/^[a-z]{2}$/.test(s))&&known.at(-1)!=='unknown')return known.at(-1)!
      if(comma.length>1&&known.every(v=>v!=='unknown'))return known.includes('allowed')?'allowed':known.includes('worldwide')?'worldwide':'excluded'
      // A terminal ISO/known country after a city is an explicit ATS location, not a keyword in prose.
      if(comma.length>1&&known.at(-1)!=='unknown')return known.at(-1)!
      // Some ATS boards publish country, city. Preserve the raw evidence and require a
      // spelled-out country plus a locality, not an unknown alternative or US-state ambiguity.
      if(comma.length===2&&comma[0].length>2&&comma[0]!=='georgia'&&names.has(comma[0])&&
        /^[\p{L}][\p{L}\p{M} .'-]*$/u.test(comma[1])&&
        !/\b(?:unknown|undisclosed|unspecified|location|anywhere|tbd)\b/.test(comma[1]))return known[0]
      return 'unknown'
    })
    if(values.includes('worldwide'))return 'worldwide'
    if(!values.length||values.includes('unknown'))return 'unknown'
    return values.includes('allowed')?'allowed':'excluded'
  }
  return position=>{
    const listing=resolve(position.location??''),requirements:Region[]=[],evidence:string[]=[]
    if(position.location?.trim())evidence.push(position.location)
    const lines=position.description.replace(/<\/(?:p|li|div|h[1-6])>/gi,'\n').replace(/<[^>]*>/g,' ').split(/\n|(?<=[.!?])\s+(?=[A-Z])/)
    let worldwide=listing==='worldwide',ambiguous=false
    for(const rawLine of lines) {
      // This boilerplate refers back to the advertised location; it names no new country.
      // Remove only that phrase, preserving any actual residence constraint on the same line.
      const line=rawLine.replace(/\bauthorized to work in the country in which (?:they|you) apply\b/ig,'')
      const clause=/\b(?:must|need to|required to)\s+(?:be\s+)?(?:based|located|resident|reside|live|work)\s+(?:in|from)\s+(.+)/i.exec(line)
      if(clause){requirements.push(resolve(clause[1]));evidence.push(position.description.includes(line.trim())?line.trim():position.description)}
      // A failed parse of a residence constraint is not an absence of geography.
      if(!clause&&/\b(?:must|need to|required to)\b[^.!?]*\b(?:based|located|resident|reside|live|work\s+(?:in|from))\b/i.test(line)){ambiguous=true;evidence.push(position.description.includes(line.trim())?line.trim():position.description)}
      const locationLabel=/^\s*(?:(?:work|job)\s+)?location\s*:\s*(.+)/i.exec(line)
      if(locationLabel&&!unspecifiedLabels.has(normalize(locationLabel[1]))){requirements.push(resolve(locationLabel[1]));evidence.push(position.description.includes(line.trim())?line.trim():position.description)}
      const remoteLocation=/\bremote\s+(?:in|from|within)\s+(.+)/i.exec(line)
      if(remoteLocation&&!/\banywhere\b/i.test(remoteLocation[1])){requirements.push(resolve(remoteLocation[1]));evidence.push(position.description.includes(line.trim())?line.trim():position.description)}
      if(!clause&&/\b(?:candidates|applicants|employees|you)\s+(?:(?:who\s+)?are\s+)?(?:based|located|resident|residing|living)\s+(?:in|within)\b/i.test(line)){ambiguous=true;evidence.push(position.description.includes(line.trim())?line.trim():position.description)}
      const permission=/\b(?:you|candidates|applicants|employees)\s+(?:can|may)\s+work\s+(?:remotely\s+)?from\s+(?:anywhere\s+in\s+)?(.+)/i.exec(line)
      if(permission){requirements.push(resolve(permission[1]));evidence.push(position.description.includes(line.trim())?line.trim():position.description)}
      if(/\b(?:fully\s+)?remote(?:\s+work)?[ ,:-]*(?:worldwide|globally)\b|\bworldwide\s+remote\b|\bwork\s+(?:remotely\s+)?from\s+anywhere\s+in\s+the\s+world\b/i.test(line)) {
        if(/\b(?:not|except|excluding|only|outside)\b/i.test(line))ambiguous=true
        else {worldwide=true;evidence.push(position.description.includes(line.trim())?line.trim():position.description)}
      }else if(/\b(?:work|remote)\b.*\banywhere\b/i.test(line)&&!permission&&!(listing!=='unknown'&&listing!=='excluded'&&/\balmost\s+anywhere\s*[.!]?\s*$/i.test(line)))ambiguous=true
    }
    const result=(status:GeographyCheck['status'],reason:string):GeographyCheck=>({status,reason,evidence:[...new Set(evidence)]})
    if(ambiguous||requirements.includes('unknown'))return result('unresolved','Location wording requires semantic interpretation')
    const outside=requirements.includes('excluded'),inside=requirements.includes('allowed')||requirements.includes('worldwide')
    if(outside&&(inside||worldwide||listing==='allowed')||inside&&listing==='excluded')return result('unresolved','Listing location and explicit residence/work requirements conflict')
    if(outside)return result('excluded','Explicit employee residence/work requirement is outside the configured allowed geography')
    if(worldwide||inside||listing==='allowed')return result('allowed','Explicit allowed-area or worldwide option; other shared and stack rules still apply')
    if(listing==='excluded')return result('excluded','Explicit listing location is outside the configured allowed geography')
    if(config.missingGeography==='allow'&&(!position.location?.trim()||unspecifiedLabels.has(normalize(position.location))))return result('allowed','No employee geography specified; permitted by selection policy, not verified worldwide availability')
    return result('unresolved','No unambiguous employee geography; generic remote is not worldwide proof or an exclusion')
  }
}
