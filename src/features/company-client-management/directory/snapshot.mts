import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { digest } from '../legacy-snapshot.mts';
import type { DirectorySnapshot } from './types.mts';
const fail=(code:string):never=>{throw new PostgresReadError(code);};
const object=(v:unknown)=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
const strings=(v:unknown):v is string[]=>Array.isArray(v)&&v.every(text)&&new Set(v).size===v.length;
export function inspectDirectorySnapshot(value:unknown){
  const s=value as DirectorySnapshot;
  if(!s||s.version!==1||!text(s.source?.fileId)||!Number.isFinite(Date.parse(s.source.capturedAt))||!/^[a-f0-9]{64}$/.test(s.source.workbookSha256)||!Array.isArray(s.companies)||!s.companies.length||!Array.isArray(s.sources))fail('invalid_directory_snapshot');
  const keys=new Set<string>(),ids=new Set<string>(),sourceKeys=new Set<string>();
  for(const c of s.companies){
    if(!text(c.key)||!text(c.name)||typeof c.comment!=='string'||!strings(c.markets)||!strings(c.tags)||!strings(c.languages)||!strings(c.aliases)||!object(c.provenance)||!['standard_workflow','notify_only'].includes(c.applicationRoute)||!Array.isArray(c.contacts)||c.contacts.some(p=>!['email','telegram','phone','web','linkedin'].includes(p.type)||!text(p.value)))fail('invalid_directory_company');
    if(keys.has(c.key))fail('duplicate_directory_company');keys.add(c.key);
    if(c.markets.includes('Global')&&c.markets.length!==1)fail('directory_global_market_conflict');
    if(c.existingId!==undefined){
      if(!/^[1-9][0-9]{0,18}$/.test(c.existingId)||BigInt(c.existingId)>9223372036854775807n||!text(c.expectedExistingName))fail('invalid_existing_company_mapping');
      if(ids.has(c.existingId))fail('duplicate_existing_company_mapping');ids.add(c.existingId);
    }
  }
  for(const r of s.sources){
    if(!text(r.key)||!text(r.name)||typeof r.comment!=='string'||!['website','aggregator','tg-channel','linkedin'].includes(r.type)||!['enabled','blocked_linkedin','superseded'].includes(r.disposition)||!object(r.provenance))fail('invalid_directory_source');
    if(sourceKeys.has(r.key))fail('duplicate_directory_source');sourceKeys.add(r.key);
    if(r.companyKey!==null&&!keys.has(r.companyKey))fail('source_company_missing');
    let url:URL;try{url=new URL(r.url);}catch{fail('invalid_source_url');}
    if(!['https:','http:'].includes(url!.protocol)||!url!.hostname.includes('.')||url!.username||url!.password)fail('invalid_source_url');
    const host=url!.hostname.toLowerCase().replace(/\.$/,'');
    const linkedin=host==='linkedin.com'||host.endsWith('.linkedin.com')||host==='lnkd.in'||host.endsWith('.lnkd.in');
    if((linkedin||r.type==='linkedin')&&(r.type!=='linkedin'||r.disposition!=='blocked_linkedin'))fail('linkedin_source_must_be_blocked');
  }
  return {checksum:digest(s),companies:s.companies.length,sources:s.sources.length,notifyOnly:s.companies.filter(c=>c.applicationRoute==='notify_only').length,existingMappings:ids.size};
}
