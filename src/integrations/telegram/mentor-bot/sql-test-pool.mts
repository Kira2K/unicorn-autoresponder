import type { SqlPool } from '../../postgres/contracts.mts';
import type {PilotScope} from './pilot-scope.mts';
type Tables=Record<string,Record<string,unknown>>;
type Data={tables:Tables;offset:number;mentors:unknown;clients:Record<string,unknown>[];events:Record<string,unknown>[]};
/** Transactional SQL protocol double, NOT a SQL engine or migration validator. */
export function sqlTestPool(options:{pilot?:PilotScope;extraClients?:Record<string,unknown>[]}={}){
  let data:Data={tables:Object.fromEntries(['learners','sessions','checkins','deliveries','operations','history'].map(t=>[t,{}])),
    offset:0,mentors:{},clients:[{id:'1',client_name:'Тестовый ученик',telegram_personal_chat_id:'@alice',
      client_status:'studying',market_id:1,telegram_general_chat_id:'-100',secured_general_chat_id:'',
      tg_hard_mentor:'@hardmentor',tg_soft_mentor:'@softmentor',stack_name:'TypeScript'},...(options.extraClients??[])],events:[]};
  const fault={beforeCommit:false,beforeWrite:false,loseCommitReply:false,missingStatusHistory:false};
  const queries:string[]=[];
  const pool:SqlPool={
    async connect(){
      let draft:Data|undefined;
      return {release(){},async query(sql,values=[]){
        queries.push(sql);
        if(options.pilot)sql=sql.replaceAll('mentor_bot_pilot_'+options.pilot.clientId+'.','mentor_bot.');
        if(sql==='BEGIN READ WRITE'||sql==='BEGIN READ ONLY'){draft=structuredClone(data);return {rows:[]};}
        if(sql==='ROLLBACK'){draft=undefined;return {rows:[]};}
        if(sql==='COMMIT'){
          if(fault.beforeCommit){fault.beforeCommit=false;throw Error('precommit');}
          data=draft!;draft=undefined;
          if(fault.loseCommitReply){fault.loseCommitReply=false;throw Error('uncertain');}
          return {rows:[]};
        }
        const s=draft??data;
        if(sql.includes('pg_advisory_xact_lock'))return {rows:[]};
        if(sql.startsWith('SELECT current_database()'))return {rows:[{database:'mentor_bot_test',environment:'local-test',binding:options.pilot?.binding}]};
        if(sql.startsWith('SELECT update_offset'))return {rows:[{update_offset:s.offset}]};
        if(sql.startsWith('SELECT mentor_overrides'))return {rows:[{mentor_overrides:s.mentors}]};
        if(sql.startsWith('UPDATE mentor_bot.runtime')){
          if(sql.includes('SET mentor_overrides=')){s.mentors=JSON.parse(String(values[0]));return {rows:[]};}
          s.offset=sql.includes('GREATEST')?Math.max(s.offset,Number(values[0])):Number(values[0]);return {rows:[]};
        }
        if(sql.startsWith('SELECT id FROM noco.clients'))return {rows:s.clients.map(c=>({id:c.id}))};
        if(sql.startsWith('SELECT c.id'))return {rows:structuredClone(sql.includes('AND c.id=$1')?
          s.clients.filter(c=>String(c.id)===values[0]):sql.includes('AND c.id=ANY')?
          s.clients.filter(c=>(values[0] as string[]).includes(String(c.id))):s.clients)};
        if(sql.startsWith('SELECT h.id'))return {rows:structuredClone(s.events)};
        if(sql.startsWith('SELECT COALESCE(max(id),0)'))return {rows:[{id:String(Math.max(0,...s.events
          .filter(e=>e.client_id===values[0]).map(e=>Number(e.id))))}]};
        if(sql.startsWith('SELECT id FROM noco.client_status_history')||sql.startsWith('SELECT id FROM mentor_bot.status_history'))return {rows:structuredClone(s.events.filter(e=>
          e.client_id===values[0]&&Number(e.id)>Number(values[1])&&(e.old_status??'')===values[2]&&e.new_status===values[3]))};
        if(sql.startsWith('UPDATE noco.clients')){
          const c=s.clients.find(c=>c.id===values[0]);if(!c)return {rows:[]};
          for(const match of sql.matchAll(/(client_status|market_id|tg_hard_mentor|tg_soft_mentor)=\$(\d+)/g)){
            const field=match[1],value=values[Number(match[2])-1];
            if(field==='client_status'&&c[field]!==value&&!fault.missingStatusHistory)s.events.push({id:String(s.events.length+1),client_id:c.id,
              old_status:c[field],new_status:value,changed_at:new Date('2026-10-20T09:00:00Z')});
            c[field]=value;
          }
          return {rows:[{id:c.id}]};
        }
        const select=sql.match(/^SELECT (?:d\.)?key,(?:d\.)?payload FROM mentor_bot\.([a-z]+)/);
        if(select){
          let rows=Object.entries(s.tables[select[1]]).map(([key,payload])=>({key,payload:structuredClone(payload)}));
          if(sql.includes('WHERE key=ANY'))rows=rows.filter(r=>(values[0] as string[]).includes(r.key));
          else if(sql.includes('WHERE key=$1'))rows=rows.filter(r=>r.key===values[0]);
          else if(sql.includes("payload->>'state'='pending'"))rows=rows.filter(r=>{
            const d=r.payload as {clientId:string;state:string;retryAt:number;claimedAt?:number;relevance?:string;expiresAt?:number};
            const l=s.tables.learners[d.clientId] as {syncError?:string}|undefined;
            if(l?.syncError&&d.relevance&&(d.expiresAt??Number(values[0])+1)>Number(values[0]))return false;
            return d.state==='pending'&&d.retryAt<=Number(values[0])||d.state==='sending'&&(d.claimedAt??0)+Number(values[1])<=Number(values[0]);
          }).sort((a,b)=>(a.payload as {retryAt:number}).retryAt-(b.payload as {retryAt:number}).retryAt||a.key.localeCompare(b.key)).slice(0,100);
          return {rows};
        }
        const insert=sql.match(/^INSERT INTO mentor_bot\.([a-z]+)/);
        if(insert){
          if(fault.beforeWrite){fault.beforeWrite=false;throw Error('write failed');}
          s.tables[insert[1]][String(values[0])]=JSON.parse(String(values[1]));return {rows:[]};
        }
        if(sql.startsWith('DELETE FROM mentor_bot.sessions')){delete s.tables.sessions[String(values[0])];return {rows:[]};}
        throw Error('Unexpected SQL in protocol double');
      }};
    },async end(){}
  };
  return {pool,fault,queries,snapshot:()=>structuredClone(data)};
}
