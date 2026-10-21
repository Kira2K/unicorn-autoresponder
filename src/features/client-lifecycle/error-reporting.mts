import type { TelegramErrorReporter, SendOneResult } from '../../integrations/telegram/types.ts';
import type { Store, Delivery } from './worker.ts';

function category(result: SendOneResult): string {
  if (result.kind==='client-failure') return result.failure.stage;
  if (result.response.ok) return 'success';
  if (result.response.error_code===400 && /chat not found/i.test(result.response.description)) return 'chat_not_found';
  if (result.response.error_code===403) return 'forbidden';
  return `telegram_${result.response.error_code}`;
}

/** Existing SQL journal, one report per student/target/error per 24h, across restarts. */
export function clientErrorReporter(store: Store, now:()=>Date=()=>new Date()): TelegramErrorReporter {
  return async (report,send) => {
    const clientId=report.context?.clientId;
    if (!Number.isSafeInteger(clientId) || Number(clientId)<=0 || !report.sourceChatId)
      throw Error('client_error_report_context_required');
    if (!store.claimReport) throw Error('client_error_report_store_required');
    const code=category(report.result),chat=report.sourceChatId;
    const key=`delivery-error:${clientId}:${chat}:${code}`;
    if (!await store.claimReport(key,clientId!,[chat,code],now())) return;
    let delivery:Delivery;
    try {
      const result=await send();
      if (result.kind==='client-failure') delivery={outcome:'uncertain',code:result.failure.stage};
      else if (result.response.ok) delivery={outcome:'sent',messageId:result.response.result.message_id};
      else delivery={outcome:'failed',code:`telegram_${result.response.error_code}`};
    } catch { delivery={outcome:'uncertain',code:'report_result_unknown'}; }
    await store.finish(key,delivery);
  };
}
