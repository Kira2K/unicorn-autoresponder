import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,realpath,rm} from 'node:fs/promises';
import {basename,resolve,sep} from 'node:path';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
const req=createRequire(import.meta.url),{Client}=req('pg');
const binArgument=process.argv.indexOf('--bin'),binaryFolder=resolve(binArgument>=0?process.argv[binArgument+1]:'tmp/sql-runtime/node_modules/@embedded-postgres/windows-x64/native/bin');
const executable=(name:string)=>resolve(binaryFolder,name+(process.platform==='win32'?'.exe':''));
const crmArgument=process.argv.indexOf('--crm-snapshot'),crmSnapshot=crmArgument>=0?resolve(process.argv[crmArgument+1]):'';
const runId=randomUUID(),root=resolve('tmp/sql-runtime'),folder=resolve(root,'run-'+runId),cluster=resolve(folder,'cluster');await mkdir(folder,{recursive:true});
execFileSync(executable('initdb'),['-D',cluster,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8','--no-sync'],{windowsHide:true,stdio:'pipe',timeout:30000});
const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
let started=false;
try{
 // Windows postmaster inherits pipe handles: do not wait for those pipes to close.
 execFileSync(executable('pg_ctl'),['-D',cluster,'-l',resolve(folder,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{windowsHide:true,stdio:'ignore',timeout:30000});started=true;
 const connection={host:'127.0.0.1',port,user:'postgres',connectionTimeoutMillis:5000};
 const admin=new Client({...connection,database:'postgres'});await admin.connect();
 try{await admin.query('CREATE DATABASE unicorn_noco_copy_restore');await admin.query("COMMENT ON DATABASE unicorn_noco_copy_restore IS 'unicorn-noco-copy:pqe5susktrsa9z3:20260911:v1'");}finally{await admin.end();}
 const client=new Client({...connection,database:'unicorn_noco_copy_restore'});await client.connect();
 try{await client.query('CREATE SCHEMA test_runtime;CREATE TABLE test_runtime.guard(run_id text)');await client.query('INSERT INTO test_runtime.guard VALUES($1)',[runId]);}finally{await client.end();}
 const child=spawn(process.execPath,['--test','src/features/linkedin-automation/proxy-move/isolated.sql.test.mts'],{windowsHide:true,stdio:'inherit',env:{...process.env,APP_DB_POSTGRES_HOST:'127.0.0.1',APP_DB_POSTGRES_PORT:String(port),APP_DB_POSTGRES_DATABASE:'unicorn_noco_copy_restore',APP_DB_POSTGRES_USER:'postgres',APP_DB_POSTGRES_PASSWORD:'isolated-only',APP_DB_POSTGRES_SSL_CA:'',LINKEDIN_SQL_ISOLATED_RUN_ID:runId,LINKEDIN_CRM_SQL_SNAPSHOT:crmSnapshot}});
 const code=await new Promise<number|null>((done,reject)=>{child.once('error',reject);child.once('exit',done);});process.exitCode=code??1;
}finally{
 if(started)execFileSync(executable('pg_ctl'),['-D',cluster,'-w','stop','-m','fast'],{windowsHide:true,stdio:'ignore',timeout:30000});
 if(started){const target=await realpath(cluster),allowed=await realpath(root);assert.ok(target.startsWith(allowed+sep)&&basename(target)==='cluster');await rm(target,{recursive:true});}
}
