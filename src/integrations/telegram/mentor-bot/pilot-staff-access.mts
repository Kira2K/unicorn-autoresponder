import type {Client} from './types.mts';
import type {TestConfig} from './test-config.mts';
import {username} from './policy.mts';

/** Keep explicit test staff and admit current assigned mentors only for this selected client. */
export function pilotStaffAllowed(config:Pick<TestConfig,'studentUsername'|'botUsername'|'staffUsernames'>,
  client:Pick<Client,'hardMentor'|'softMentor'>|undefined,actor:string):boolean {
  const tag=username(actor);
  if(!client||!tag||tag===config.studentUsername||tag===config.botUsername)return false;
  return [...config.staffUsernames,client.hardMentor,client.softMentor].some(value=>username(value)===tag);
}
