import assert from 'node:assert/strict';
import type {Page,BrowserContext} from 'playwright';
import {readJson,waitForCycle,evidenceScreenshot} from './ui.mts';
import type {RunJournal} from './journal.mts';
export async function verifyCycleCompletion(admin:{page:Page;context:BrowserContext},journal:RunJournal,taskId:number,cycle:number){
 await admin.page.getByRole('button',{name:'Обновить заявки',exact:true}).click();
 await admin.page.getByTestId(`admin-creation-task-${taskId}`).click();
 await waitForCycle(async()=>{const d=await readJson(admin.context,`/api/admin/linkedin-creation/tasks/${taskId}`);
  return d.notification.deliveries.length===2&&d.notification.deliveries.every((n:{state:string;messageId?:number})=>n.state==='sent'&&Number(n.messageId)>0);},'e2e_completion_delivery_not_verified',90000);
 const completed=await readJson(admin.context,`/api/admin/linkedin-creation/tasks/${taskId}`);
 assert.equal(completed.task.status,'сделана экспертом');
 assert.equal(await admin.page.getByTestId('admin-confirm-creation').count(),0);
 await journal.record({step:`cycle-${cycle}-completion-readback`,expected:'Денис завершил заявку; обе доставки подтверждены',
  actual:'Состояние заявки и две независимые доставки sent перечитаны без команды подтверждения.',state:'passed',
  db:{taskId,deliveries:completed.notification.deliveries},screenshot:await evidenceScreenshot(admin.page,journal,`cycle-${cycle}-completed`)});
}
