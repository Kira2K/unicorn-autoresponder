import {harness} from './test-harness.mts';
// Deliberately no dotenv, token reader, PostgreSQL connection or real Telegram requester.
const args=process.argv.slice(2);
if(args.some(arg=>!['--check','--demo'].includes(arg))) {
  console.error('Mentor Bot: only offline --check / --demo are available. No production launcher is provided.');
  process.exitCode=1;
}else{
  const h=harness();
  await h.command('/menu');
  await h.click('stage');
  if(args.includes('--demo')){
    await h.command('/hard_done','mentor');await h.click('confirm','mentor');
    await h.command('/ready_pitch');await h.click('yes');await h.click('confirm');
  }
  const s=h.store.snapshot();
  console.log(JSON.stringify({mode:'offline',telegramRequests:0,databaseConnections:0,
    sessions:Object.keys(s.sessions).length,operations:Object.keys(s.history).length,mockMessages:h.sent.length}));
}
