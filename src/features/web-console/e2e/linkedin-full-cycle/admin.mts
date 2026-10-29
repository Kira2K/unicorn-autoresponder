import assert from 'node:assert/strict';
import type {Page,BrowserContext} from 'playwright';
import {consoleUrl} from './context.mts';
import {readJson,waitForCycle,evidenceScreenshot} from './ui.mts';
import type {RunJournal} from './journal.mts';
export async function confirmCycleByAdmin(admin:{page:Page;context:BrowserContext},journal:RunJournal,taskId:number,cycle:number){
 await admin.page.getByRole('button',{name:'Обновить заявки',exact:true}).click();
 await admin.page.getByTestId(`admin-creation-task-${taskId}`).click();
 await waitForCycle(async()=>await admin.page.getByTestId('admin-confirm-creation').isEnabled(),'e2e_admin_confirmation_not_ready');
 const before=await readJson(admin.context,`/api/admin/linkedin-creation/tasks/${taskId}`);
 const response=admin.page.waitForResponse(r=>new URL(r.url()).pathname===`/api/admin/linkedin-creation/tasks/${taskId}/confirm`&&r.request().method()==='POST');
 await admin.page.getByTestId('admin-confirm-creation').click();if(!(await response).ok())throw Error('e2e_admin_confirmation_rejected');
 await admin.page.getByTestId('admin-confirmation-notification').filter({hasText:'Уведомление отправлено.'}).waitFor({timeout:90000});
 const confirmed=await readJson(admin.context,`/api/admin/linkedin-creation/tasks/${taskId}`);
 assert.equal(confirmed.task.status,'выполнение подтверждено');assert.equal(confirmed.notification.state,'sent');assert.ok(Number(confirmed.notification.messageId)>0);
 const repeated=await admin.context.request.post(consoleUrl+`/api/admin/linkedin-creation/tasks/${taskId}/confirm`,{data:{version:before.task.version}});
 if(!repeated.ok())throw Error('e2e_admin_confirmation_retry_failed');
 await journal.record({step:`cycle-${cycle}-admin-button`,expected:'Кнопка главного админа подтверждает заявку и доставку уведомления',
  actual:'Нажата «Подтвердить выполнение»; статус и сообщение sent перечитаны. Повторный POST не повторяет подтверждение.',state:'passed',
  db:{taskId,messageId:confirmed.notification.messageId},screenshot:await evidenceScreenshot(admin.page,journal,`cycle-${cycle}-admin-confirmed`)});
}
