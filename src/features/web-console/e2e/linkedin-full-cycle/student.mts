import assert from 'node:assert/strict';import type {Page} from 'playwright';
import type {RunJournal} from './journal.mts';import {evidenceScreenshot,submitAndRead} from './ui.mts';
export async function submitCycleIntake(page:Page,journal:RunJournal,cycle:number){
 const workflow=page.getByTestId('linkedin-octo-workflow');await workflow.waitFor();
 if(cycle===1)await workflow.getByRole('button',{name:'Нет LinkedIn / аккаунт заблокирован',exact:true}).click();
 else await workflow.getByRole('button',{name:'Меня забанили',exact:true}).click();
 const form=workflow.getByTestId('linkedin-new-form');await form.waitFor();
 const outlook=form.getByTestId('linkedin-outlook-details');if(!await outlook.evaluate((e:HTMLDetailsElement)=>e.open))await outlook.locator('summary').click();
 assert.equal(await form.getByLabel('Логин от новой почты Outlook',{exact:true}).inputValue(),'');
 await form.getByLabel('Логин от новой почты Outlook',{exact:true}).fill(`e2e-${journal.data.runId}-${cycle}@outlook.com`);
 await form.getByRole('button',{name:cycle===1?'Сохранить и подготовить Octo':'Сохранить и подготовить Octo',exact:true}).click();
 await form.getByTestId('linkedin-validation-error').waitFor();
 await form.getByLabel('Пароль от новой почты Outlook',{exact:true}).fill(`SYNTHETIC-${journal.data.runId}-${cycle}`);
 await form.getByLabel('Дата и время регистрации Outlook-почты',{exact:true}).fill('2026-10-25T10:30');
 await form.getByLabel('Имя латиницей (как в иностранных документах)',{exact:true}).fill('Pavel');
 await form.getByLabel('Фамилия латиницей (как в иностранных документах)',{exact:true}).fill('Testov');
 await form.getByLabel('Город и страна проживания',{exact:true}).fill('Tbilisi, Georgia');
 const result=await submitAndRead(page,'/api/client/linkedin-intake',()=>form.getByRole('button',{name:'Сохранить и подготовить Octo',exact:true}).click());
 assert.ok(result.task?.id);await page.getByRole('dialog').waitFor();
 await journal.record({step:`cycle-${cycle}-intake`,expected:'Одна новая заявка с новой Outlook-почтой',actual:'Анкета сохранена через интерфейс; обязательные поля объясняются до отправки',state:'passed',db:{taskId:result.task.id},screenshot:await evidenceScreenshot(page,journal,`cycle-${cycle}-intake`)});
 await page.reload();await workflow.getByTestId('linkedin-registration-pending').waitFor();
 assert.equal(await workflow.getByTestId('linkedin-report-ban').count(),0);
 assert.equal(await workflow.locator('.scenario-buttons').count(),0);
 const edit=workflow.getByTestId('linkedin-new-form');const edited=await submitAndRead(page,'/api/client/linkedin-intake',()=>edit.getByRole('button',{name:'Сохранить изменения',exact:true}).click());
 assert.equal(edited.task.id,result.task.id,'repeated save cannot create another application');return Number(result.task.id);
}
