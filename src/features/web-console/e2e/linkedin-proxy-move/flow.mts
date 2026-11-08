import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import type {ProxyInput} from '../../../octo-access/contracts.mts';
export async function runProxyMoveFlow(page:Page,input:ProxyInput,openAndClose?:()=>Promise<void>) {
  const base=new URL(page.url()).origin,path='/api/client/linkedin-proxy-move';
  await page.getByRole('button',{name:'Сменить прокси (Octo)',exact:true}).click();
  const card=page.getByTestId('linkedin-proxy-move');await card.waitFor();
  const status=async()=>{const r=await page.context().request.get(base+path);if(!r.ok())throw Error('e2e_proxy_move_status_unavailable');return r.json();};
  let state=await status();
  await card.getByTestId('proxy-move-step-3').locator('summary').click();
  if(!state.move){
    await card.getByTestId('proxy-move-type').selectOption(input.type);
    for(const field of ['host','port','login','password'] as const)await card.getByTestId(`proxy-move-${field}`).fill(String(input[field]));
    const result=page.waitForResponse(r=>new URL(r.url()).pathname===path+'/proxy'&&r.request().method()==='POST');
    await card.getByTestId('proxy-move-save').click();if(!(await result).ok())throw Error('e2e_proxy_move_assignment_rejected');
  }
  const until=Date.now()+180000;
  do{state=await status();if(['assigned','completed'].includes(state.move?.phase))break;if(state.move?.error)throw Error('e2e_proxy_move_assignment_blocked');await new Promise(r=>setTimeout(r,1000));}while(Date.now()<until);
  assert.ok(['assigned','completed'].includes(state.move?.phase),'new connection must be confirmed before step 4');
  if(state.move.phase==='completed')return state;
  await page.reload();await page.getByRole('button',{name:'Сменить прокси (Octo)',exact:true}).click();
  await card.getByTestId('proxy-move-step-3').locator('summary').click();
  await card.getByText('Новый прокси подключён к EN.',{exact:true}).waitFor();
  await card.getByTestId('proxy-move-step-4').locator('summary').click();
  if(openAndClose)await openAndClose();
  await card.getByTestId('proxy-move-country-confirmation').check();
  const finish=card.getByTestId('proxy-move-finish');await finish.waitFor({state:'visible'});
  const result=page.waitForResponse(r=>new URL(r.url()).pathname===path+'/finish');await finish.click();
  const r=await result;if(!r.ok())throw Error('e2e_proxy_move_finish_rejected');state=await r.json();assert.equal(state.move.phase,'completed');
  const repeated=await page.context().request.post(base+path+'/finish',{data:{countryChanged:true}});assert.equal(repeated.status(),200);assert.equal((await repeated.json()).move.id,state.move.id);
  return state;
}
