import { OctoError } from '../../octo-access/contracts.mts';
import type { ManagedProfile, ProxyInput } from '../../octo-access/contracts.mts';
export const destinations = { ES: { country:'Испания', city:'Барселона' }, GE: { country:'Грузия', city:'Тбилиси' } } as const;
export type Country = keyof typeof destinations;
export function destination(answer:unknown):Country|undefined {
  const value=String(answer??'').trim().toLowerCase();
  return ['yes','да'].includes(value)?'ES':['no','нет'].includes(value)?'GE':undefined;
}
export function checkedCountry(value:unknown):Country|undefined {
  const v=String(value??'').trim().toLowerCase();
  return ['es','spain','españa','испания'].includes(v)?'ES':['ge','georgia','грузия'].includes(v)?'GE':undefined;
}
export function fail(code:string):never { throw new OctoError(`linkedin_proxy_move_${code}`,409); }
export interface Move {
  id:string;clientId:number;accountId:number;profileId:number;profileUuid:string;country:Country;
  phase:'assigning'|'assigned'|'completed';fingerprint:string;previousProxy?:unknown;
  createdAt:string;completedAt?:string;pauseUntil?:string;
  proof?:{exitIp:string;country:Country;checkedAt:string};
}
export interface MoveStore {
  checkSchema():Promise<void>;
  read(clientId:number,accountId:number):Promise<Move|undefined>;
  begin(move:Move,profile:ManagedProfile,input:ProxyInput):Promise<void>;
  finish(move:Move,profile:ManagedProfile,at:string):Promise<Move>;
}
export function crmProxyPause(move:Move,now:number) {
  if(!move.completedAt||!move.pauseUntil)fail('not_completed');
  return {eventId:move.id,accountId:move.accountId,status:now<Date.parse(move.pauseUntil!)?'Пауза':'Раскачка',
    reason:'Изменение прокси',occurredAt:move.completedAt,pauseUntil:move.pauseUntil};
}
