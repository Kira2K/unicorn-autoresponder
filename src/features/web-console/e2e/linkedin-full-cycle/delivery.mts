import { open, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { SendOneInput, SendOneResult } from '../../../../integrations/telegram/types.ts';
import type { CycleJournal } from './journal.mts';

type Receipt = { state: 'attempting' | 'sent' | 'rejected' | 'uncertain'; messageId?: number; code?: number };
export interface DeliveryStore {
  claim(chatId: string, pdfHash: string): Promise<boolean>;
  finish(chatId: string, receipt: Receipt): Promise<void>;
}

/** Exclusive creation is the durable send claim. A lost response requires manual review. */
export function fileDeliveryStore(directory: string): DeliveryStore {
  const path = (chatId: string) => resolve(directory, `delivery-${chatId}.json`);
  return {
    async claim(chatId, pdfHash) {
      let handle;
      try { handle = await open(path(chatId), 'wx', 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
      try { await handle.writeFile(JSON.stringify({ state: 'attempting', pdfHash, at: new Date().toISOString() })); await handle.sync(); }
      finally { await handle.close(); }
      return true;
    },
    async finish(chatId, receipt) {
      const current = JSON.parse(await readFile(path(chatId), 'utf8'));
      const temporary = path(chatId) + '.next';
      await writeFile(temporary, JSON.stringify({ ...current, ...receipt }), { mode: 0o600 });
      await rename(temporary, path(chatId));
    }
  };
}

export async function deliverSuccessfulReport(input: {
  journal: CycleJournal; pdf: Uint8Array; kiraChatId: string;
  credentials: { manualLogin: string; manualPassword: string };
  store: DeliveryStore; sendOne: (input: SendOneInput) => Promise<SendOneResult>;
}) {
  const { journal, pdf, credentials, store } = input;
  if (!journal.passed || !journal.manualClientId || ![1, 2].every(c => journal.completedCycles.includes(c)))
    throw Error('e2e_success_delivery_not_allowed');
  if (!/^\d+$/.test(input.kiraChatId) || input.kiraChatId === '315110920') throw Error('e2e_private_destinations_invalid');
  if (!credentials.manualLogin || !credentials.manualPassword || pdf.length > 5 * 1024 * 1024 ||
    new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') throw Error('e2e_report_invalid');
  const text = `Проверка LinkedIn пройдена: первый аккаунт → бан → новый аккаунт. Инструкция в PDF.\n` +
    `Для ручной проверки: Илья Проверкин\nhttps://very-evil-unicorn.onrender.com/\n` +
    `Логин: ${credentials.manualLogin}\nПароль: ${credentials.manualPassword}`;
  if (text.length > 1024) throw Error('e2e_report_invalid');
  const pdfHash = createHash('sha256').update(pdf).digest('hex');
  const result: Record<string, Receipt['state'] | 'already-attempted'> = {};
  for (const chatId of [input.kiraChatId, '315110920']) {
    if (!await store.claim(chatId, pdfHash)) { result[chatId] = 'already-attempted'; continue; }
    let receipt: Receipt = { state: 'uncertain' };
    try {
      const sent = await input.sendOne({ chatId, text, attachment: { fileName: 'linkedin-e2e.pdf', mimeType: 'application/pdf', data: pdf } });
      if (sent.kind === 'telegram-response') {
        const response = sent.response;
        if (!response.ok) receipt = { state: 'rejected', code: response.error_code };
        else if (response.result.chat.type === 'private' && String(response.result.chat.id) === chatId && 'document' in response.result)
          receipt = { state: 'sent', messageId: response.result.message_id };
      }
    } catch { /* No raw exception, token, document or credentials enter receipts. */ }
    await store.finish(chatId, receipt);
    result[chatId] = receipt.state;
  }
  return result;
}
