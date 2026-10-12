import type { fixture } from './fixture.mts';
import { sourceTables } from '../legacy-snapshot.mts';
import { quoted } from '../../../integrations/postgres/catalog.mts';
export async function seedLegacy(f:Awaited<ReturnType<typeof fixture>>) {
  const column=(id:string,title:string,sqlName:string,pk=false,sqlType='text')=>({id,title,sqlName,pk,sqlType,uidt:pk?'ID':'SingleLineText'});
  const link=(id:string,title:string,target:string,child:string,parent:string,more:Record<string,unknown>={})=>({id,title,sqlName:id,sqlType:'jsonb',uidt:'LinkToAnotherRecord',colOptions:{type:'bt',fk_related_model_id:target,fk_child_column_id:child,fk_parent_column_id:parent,...more}});
  const students=sourceTables.student_stop_list,companies=sourceTables.company,restrictions=sourceTables.restriction,applications=sourceTables.application;
  const tables=[
    {id:students,title:'clients',name:'Student Records',columns:[column('cclient','Id','Record Id',true,'bigint'),column('cstop','stop_list_company','stop_list_company')]},
    {id:companies,title:'companies_from_applications',name:'legacy_companies',columns:[column('cp','Id','id',true,'bigint'),column('cn','company_name','name')]},
    {id:restrictions,title:'client_company_restrictions_from_stop_companies',name:'legacy_restrictions',columns:[
      column('rid','Id','id',true,'bigint'),column('rcid','clients_id','client_id',false,'bigint'),column('rm','market','market'),column('rt','offer_companies','names'),
      link('rclient','rel_restrictions_client',students,'rcid','cclient'),
      link('rcompanies','rel_restrictions_blocked_companies',companies,'rid','cp',{type:'mm',fk_mm_model_id:'mrestrictlinks',fk_mm_child_column_id:'jr',fk_mm_parent_column_id:'jc'})
    ]},
    {id:'mrestrictlinks',title:'restriction_links',name:'legacy_restriction_links',columns:[column('jr','restriction_id','restriction_id',true,'bigint'),column('jc','company_id','company_id',true,'bigint')]},
    {id:applications,title:'applications_from_otkliki',name:'legacy_applications',columns:[
      column('aid','Id','id',true,'bigint'),column('acid','clients_id','client_id',false,'bigint'),column('acomp','companies_from_applications_id','company_id',false,'bigint'),column('ast','status_raw','status'),
      link('aclient','rel_applications_client',students,'acid','cclient'),link('acompany','rel_applications_company',companies,'acomp','cp')
    ]}
  ];
  await f.db.exec(`ALTER TABLE noco."Student Records" ADD COLUMN stop_list_company text;
    UPDATE noco."Student Records" SET stop_list_company='Unlinked text restriction' WHERE "Record Id"=1;
    CREATE TABLE noco.legacy_companies(id bigint PRIMARY KEY,name text);
    INSERT INTO noco.legacy_companies VALUES(10,'One'),(11,'One');
    CREATE TABLE noco.legacy_restrictions(id bigint PRIMARY KEY,client_id bigint,market text,names text);
    INSERT INTO noco.legacy_restrictions VALUES(20,1,'en','One');
    CREATE TABLE noco.legacy_restriction_links(restriction_id bigint,company_id bigint,PRIMARY KEY(restriction_id,company_id));
    INSERT INTO noco.legacy_restriction_links VALUES(20,10),(20,11);
    CREATE TABLE noco.legacy_applications(id bigint PRIMARY KEY,client_id bigint,company_id bigint,status text);
    INSERT INTO noco.legacy_applications VALUES(30,1,10,'Interview');`);
  await f.db.exec('DELETE FROM copy_meta.inventory');
  for(const t of tables) {
    const keys=t.columns.filter(c=>'pk' in c && c.pk).map(c=>quoted(c.sqlName)+'::text').join(',');
    await f.db.exec(`ALTER TABLE noco.${quoted(t.name)} ADD COLUMN _copy_id text UNIQUE;
      UPDATE noco.${quoted(t.name)} SET _copy_id=replace(jsonb_build_array(${keys})::text, ', ', ',');`);
    const definition={...t,table_name:t.name,sqlName:t.name,sqlTable:'noco.'+t.name,mapping:t.columns.map(c=>({id:c.id,title:c.title,sqlName:c.sqlName,sqlType:c.sqlType}))};
    await f.db.query('INSERT INTO copy_meta.inventory VALUES($1,$2::jsonb)',[t.id,JSON.stringify(definition)]);
  }
}
