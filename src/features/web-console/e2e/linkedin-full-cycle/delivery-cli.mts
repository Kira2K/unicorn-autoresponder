import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCycleArgs } from './contracts.mts';
import { openCycleJournal } from './journal.mts';
import { cycleContext } from './context.mts';
import { createTelegramIntegration } from '../../../../integrations/telegram/integration.ts';
import { deliverSuccessfulReport, fileDeliveryStore } from './delivery.mts';

// Explicit delivery command; the live runner itself never silently sends a PDF.
const [runId, pdfPath, ...extra] = process.argv.slice(2);
try {
  if (!runId || !pdfPath || extra.length) throw Error('e2e_delivery_arguments');
  parseCycleArgs(['--run-id', runId]);
  const journal = await openCycleJournal(runId);
  if (!journal.data.passed || !journal.data.manualClientId) throw Error('e2e_success_delivery_not_allowed');
  const credentials = JSON.parse(await readFile(resolve(journal.dir, 'manual-private.json'), 'utf8'));
  const pdf = await readFile(resolve(pdfPath));
  const context = await cycleContext(process.env);
  try {
    const bot = createTelegramIntegration({ token: context.vars.VEU_SUPPORT_BOT, regularErrorChatId: '', summaryLogsChatId: '', logger() {} });
    const result = await deliverSuccessfulReport({ journal: journal.data, pdf, credentials, kiraChatId: context.vars.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID || '',
      store: fileDeliveryStore(journal.dir), sendOne: bot.sendOne });
    console.log(JSON.stringify(result));
    if (Object.values(result).some(v => v !== 'sent')) process.exitCode = 2;
  } finally { await context.close(); }
} catch (error) {
  console.error(/^e2e_[a-z_]+$/.test((error as Error).message) ? (error as Error).message : 'e2e_delivery_failed');
  process.exitCode = 1;
}
