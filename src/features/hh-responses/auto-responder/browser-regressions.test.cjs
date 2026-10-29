const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../browser-responder/index.js'),'utf8');
const start = source.indexOf('    function isResumeVisibilityRequiredResponse()');
const finish = source.indexOf('    function markVacancyProcessedAndReturn',start);
const visibilityFunction = source.slice(start,finish);
function warningResult(height, body = 'Чтобы откликнуться, поменяйте видимость резюме') {
  const warning = {innerText:body,textContent:body,getBoundingClientRect:()=>({width:700,height})};
  return new Function('queryVisible','getNormalizedPageText',visibilityFunction+'; return isResumeVisibilityRequiredResponse();')(
    () => height ? warning : undefined, () => body.toLowerCase());
}
test('HH keeps a collapsed 0px warning in innerText; it must not block responses',()=>{
  assert.equal(warningResult(0),false);
  assert.equal(warningResult(80),true);
});
test('previous parser logs mentioning visibility are not an HH rejection',()=>{
  assert.equal(warningResult(0,'HH не разрешил отклик из-за видимости резюме; компаниям'),false);
});
function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
}
function makeState(local) {
    const prefix='hh_ar_v2_';
    const names={history:'processed_ids',successfulResponseIds:'successful_response_ids',successfulResponses:'successful_responses',stopReason:'stop_reason',isRunning:'is_active'};
    const sandbox={localStorage:local,sessionStorage:storage(),location:{href:'https://hh.ru/vacancy/7'},stopSignal:false,KEYS:Object.fromEntries(Object.entries(names).map(([k,v])=>[k,prefix+v]))};
    vm.createContext(sandbox);
    const begin=source.indexOf('    const StateManager = {');
    const end=source.indexOf('    let config =',begin);
    vm.runInContext(source.slice(begin,end)+';globalThis.state=StateManager;',sandbox);
    return sandbox;
}
test('a fresh tab retains confirmed vacancies but retries failed visibility skips',()=>{
  const local = storage({'hh_ar_v2_manual_list':'["untouched"]'});
  const before=makeState(local).state; before.addSuccessfulResponseID('v_7');
  // A closed tab must not lose the first confirmation while other resumes
  // for that vacancy are still pending. A failed visibility skip is not sent.
  before.addProcessedID('v_8');
  assert.deepEqual([...makeState(local).state.getProcessedIDs()],['v_7']);
  assert.equal(local.getItem('hh_ar_v2_manual_list'),'["untouched"]');
});
test('failed durable history write retains the confirmed count and stops further actions',()=>{
  const local=storage();local.setItem=()=>{throw Error('storage quota')};
  const sandbox=makeState(local);
  assert.equal(sandbox.state.addSuccessfulResponseID('v_7'),1);
  assert.equal(sandbox.state.getSuccessfulResponses(),1);
  assert.equal(sandbox.stopSignal,true);
  assert.equal(sandbox.state.getStopReason().reason,'vacancy_processing_error');
  assert.equal(sandbox.state.amIRunning(),false);
});

test('reinjection after HH removes the panel restores UI without another loop or lock owner',()=>{
  const guard=source.slice(0,source.indexOf('  console.log("start");'));
  const registration=source.slice(source.lastIndexOf('    window.__hhArV2Runtime ='),source.lastIndexOf('})();'));
  const program=guard+`
    window.boots++;
    window.lockAdmissions++;
    let isLoopActive=true;
    const StateManager={amIRunning:()=>window.running};
    function startLoop(){window.resumes++;isLoopActive=true}
    window.endLoop=()=>{isLoopActive=false};
    function setupUI(){if(!window.panel){window.panel=true;window.restores++}}
  `+registration+'})();';
  const saved=storage({'hh_ar_v2_successful_responses':'89'});
  const sandbox={window:{boots:0,lockAdmissions:0,restores:0,resumes:0,running:true,panel:true},document:{body:{}},sessionStorage:saved};
  vm.createContext(sandbox);
  vm.runInContext(program,sandbox);vm.runInContext(program,sandbox);
  assert.equal(sandbox.window.boots,1);assert.equal(sandbox.window.lockAdmissions,1);
  sandbox.window.panel=false;sandbox.window.endLoop();vm.runInContext(program,sandbox);
  assert.equal(sandbox.window.restores,1);assert.equal(sandbox.window.boots,1);
  assert.equal(sandbox.window.lockAdmissions,1);
  assert.equal(sandbox.window.resumes,1);
  vm.runInContext(program,sandbox);assert.equal(sandbox.window.resumes,1);
  sandbox.window.running=false;sandbox.window.endLoop();sandbox.window.panel=false;
  vm.runInContext(program,sandbox);assert.equal(sandbox.window.resumes,1);
  assert.equal(saved.getItem('hh_ar_v2_successful_responses'),'89');
  const other={window:{boots:0,lockAdmissions:0,panel:true},document:{body:{}}};
  vm.createContext(other);vm.runInContext(program,other);
  assert.equal(other.window.boots,1);
});
