// Runs the existing real Console app locally, with only Octo background work enabled.
// Requires explicit operator approval of migration/seeding and live pilot writes.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {openSqlConsole} from '../backend/postgres/runtime.mts';
import {createLiveConsoleDriver,runConsoleFlow} from './octo-console.e2e.mts';
import {ownerVerifierFromEnv} from '../../octo-access/archive-acceptance/files.mts';
import {withBridgeRoutes} from '../../octo-access/bridge/app.mts';
const require=createRequire(import.meta.url),express=require('express');
const {createWebConsoleApp}=require('../backend/app.ts');
if(process.env.OCTO_E2E_LIVE!=='1'||process.env.APP_DB!=='postgres')throw new Error('octo_live_e2e_opt_in_required');
// Fail before starting the live runtime if independent-owner verification is not configured.
const owner=await ownerVerifierFromEnv();
const driver=createLiveConsoleDriver(process.env,owner);
let runtime:Awaited<ReturnType<typeof openSqlConsole>>|undefined,server:import('node:http').Server|undefined;
try{
  await driver.assertIsolated();
  runtime=await openSqlConsole(process.env);
  // The injected repository, authentication, Octo service and SQL state are real.
  // Unrelated LinkedIn/mail automation uses existing mocks during this scoped test.
  const app=withBridgeRoutes(createWebConsoleApp({...runtime.options,useMockData:true,initializeConnectionInviter:false}),runtime.octoBridge);
  app.use(express.static(resolve('dist/web-console')));
  app.use((req:import('express').Request,res:import('express').Response)=>{
    if(req.path.startsWith('/api'))res.status(404).json({error:'not_found'});
    else res.sendFile(resolve('dist/web-console/index.html'));
  });
  server=app.listen(0,'127.0.0.1');
  await new Promise<void>(done=>server!.once('listening',done));
  await runtime.startBackground();
  const url=`http://127.0.0.1:${(server!.address() as import('node:net').AddressInfo).port}`;
  const report=await runConsoleFlow({url,driver});
  console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}catch(error){console.error(JSON.stringify({passed:false,error:'octo_live_e2e_failed',
  code:/^(octo_|sql_|postgres_|invalid_appdb_)[a-z_]+$/.test((error as any)?.code??'')?(error as any).code:undefined}));process.exitCode=1;}
finally{
  try{await driver.close();}finally{await runtime?.close();}
  await new Promise<void>(done=>server?server.close(()=>done()):done());
}
