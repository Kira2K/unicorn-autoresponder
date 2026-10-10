import type { Event } from './contracts.ts'
import { ACTION_SKIPPED } from '../action-recovery.ts'
import { listReadDiagnostic, listReadMessage } from '../../../integrations/unipile/read-retry.ts'

type FailureDescription = Pick<Event, 'code' | 'message' | 'source' | 'httpStatus' | 'diagnostic'>
const machineCode = /^[a-zA-Z0-9_/-]{1,120}$/
const errorKinds = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AggregateError'])
const record = (value: unknown): Record<string, unknown> =>
  value !== null && (typeof value === 'object' || typeof value === 'function') ? value as Record<string, unknown> : {}

function sourceFor(code: string, readDiagnostic?: string): Event['source'] {
  if (readDiagnostic) return 'Unipile'
  if (/postgres|sql_|persistence|storage|ECONN|^[0-9]{2}[A-Z0-9]{3}$/.test(code)) return 'SQL'
  if (/unipile/.test(code)) return 'Unipile'
  if (/dolphin/.test(code)) return 'Dolphin'
  if (/openai/.test(code)) return 'OpenAI'
  return 'наш код'
}

function messageFor(code: string, status: number, source: Event['source'], error: unknown) {
  if (code === ACTION_SKIPPED) return 'Действие пропущено после 20 минут восстановления. Остальные действия продолжаются.'
  const readMessage = listReadMessage(error)
  if (readMessage !== undefined) return readMessage
  if (/owner/.test(code)) return 'Потеряно право исполнителя. Новые отправки запрещены.'
  if (/operation_active/.test(code)) return 'Аккаунт занят другой фичей. Продолжим после освобождения.'
  if (/step_yield/.test(code)) return 'Шаг сохранён. Ожидаем следующую возможность продолжить.'
  if (/stop|disabled/.test(code)) return 'Автоматизация выключена. Новые действия остановлены.'
  if (status === 429 || /429|limit|cooldown/.test(code)) return 'Провайдер ограничил запросы. Срок ожидания сохранён.'
  if (/account.*(changed|identity|unverified)|identity_mismatch/.test(code)) return 'Изменилась привязка аккаунта. Нужна проверка.'
  if (/auth|401|403/.test(code)) return 'Нужна проверка доступа к аккаунту.'
  if (/writer_disabled|read_only/.test(code)) return 'Для этой фичи на backend запрещены отправки.'
  if (/stack_required|prepared_missing|not_ready/.test(code)) return 'Не хватает данных или аккаунт не готов к запуску.'
  if (source === 'SQL') return 'Не удалось сохранить или прочитать состояние. Отправки приостановлены.'
  if ((status >= 500 && status <= 599) || /timeout|unreachable|unavailable|http_5/.test(code))
    return 'Сервис временно недоступен. Назначена повторная проверка.'
  return 'Фича остановлена с ошибкой. Проверьте код ошибки и данные запуска.'
}

/** Pure journal presentation: never include raw messages, SQL or provider bodies. */
export function describeFailure(error: unknown): FailureDescription {
  const value = record(error)
  const raw = String(value.code ?? '')
  const code = machineCode.test(raw) ? raw : 'automation_internal_error'
  const status = Number(record(value.details).httpStatus ?? value.httpStatus ?? value.status)
  const readDiagnostic = listReadDiagnostic(error)
  const source = sourceFor(code, readDiagnostic)
  const diagnostics: string[] = readDiagnostic ? [readDiagnostic] : []
  let cause: unknown = error
  for (let depth = 0; cause && depth < 3; depth++) {
    const detail = record(cause)
    const kind = errorKinds.has(String(detail.name)) ? String(detail.name) : 'Error'
    const causeCode = machineCode.test(String(detail.code ?? '')) ? ` (${detail.code})` : ''
    const frames = String(detail.stack ?? '').split('\n').slice(1).flatMap(line =>
      line.replaceAll('\\', '/').match(/(?:src|node_modules)\/[a-zA-Z0-9_./-]+\.(?:[cm]?[jt]s):\d+:\d+(?=\)?$)/)?.[0] ?? []).slice(0, 4)
    diagnostics.push(`${depth ? 'Причина: ' : ''}${kind}${causeCode}${frames.length ? ': ' + frames.join(' ← ') : ''}`)
    cause = detail.cause
  }
  return {
    code, source, message: messageFor(code, status, source, error),
    ...(Number.isInteger(status) ? { httpStatus: status } : {}),
    ...(diagnostics.length ? { diagnostic: diagnostics.join('\n') } : {}),
  }
}
