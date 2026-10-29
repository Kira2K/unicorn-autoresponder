export type CheckState='passed'|'failed'|'blocked';
export interface Evidence {step:string;expected:string;actual:string;state:CheckState;at:string;screenshot?:string;db?:Record<string,unknown>}
export const fixtureNames={auto:{first:'Павел',last:'Тестов'},manual:{first:'Илья',last:'Проверкин'}} as const;
export function parseCycleArgs(args:string[]){
 let apply=false,runId:string|undefined;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--apply'){if(apply)throw Error('e2e_duplicate_apply');apply=true;}
  else if(args[i]==='--preflight'){if(args.includes('--apply'))throw Error('e2e_conflicting_mode');}
  else if(args[i]==='--run-id'){runId=args[++i];if(!runId||!/^[a-z0-9-]{8,64}$/.test(runId))throw Error('e2e_invalid_run_id');}
  else throw Error('e2e_invalid_argument');
 }
 return{apply,runId};
}
export const fixtureMarker=(runId:string,kind:keyof typeof fixtureNames)=>`linkedin-full-cycle-e2e:${runId}:${kind}`;
export const fixtureEmail=(runId:string,kind:keyof typeof fixtureNames)=>`linkedin-cycle-${runId}-${kind}@example.invalid`;
export function assertFixture(row:Record<string,unknown>,runId:string,kind:keyof typeof fixtureNames){
 const name=fixtureNames[kind];
 if(row.legend_info!==fixtureMarker(runId,kind)||row.calendar_email!==fixtureEmail(runId,kind)||row.first_name!==name.first||row.last_name!==name.last||row.client_status!=='paused'||row.client_role!=='фейк')throw Error('e2e_fixture_identity_changed');
}
