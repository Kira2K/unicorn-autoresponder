export function retryableUnipileRead(error: any): boolean {
  const code = String(error?.code ?? '')
  const status = Number(error?.details?.httpStatus)
  return ['unipile_timeout', 'unipile_unreachable', 'unipile_rate_limit'].includes(code) ||
    status === 429 || status >= 500 || Boolean(listReadDiagnostic(error))
}

// A rejected 200 response is a read-contract failure, not a fabricated HTTP 500.
const reasons = {
  missing_items: 'Нет массива записей', invalid_id: 'Нет пригодного ID записи',
  wrong_direction: 'В списке отправленных оказалась входящая заявка',
  invalid_item: 'Запись не соответствует формату', invalid_total: 'Некорректное число записей',
  changed_total: 'Число записей изменилось между страницами',
  duplicate_item: 'Повтор записей не позволяет подтвердить полноту списка',
  conflicting_item: 'У повторной записи различаются значимые данные',
  incomplete: 'Не удалось получить все записи', cursor_invalid: 'Некорректное продолжение списка',
  cursor_repeated: 'Повторяется ссылка на следующую страницу', page_limit: 'Достигнут предел чтения страниц'
} as const
type Position = { page?: number; offset?: number; item?: number; total?: number; observed?: number }
export function listReadError(code: string, reason: keyof typeof reasons, position: Position = {}) {
  return Object.assign(new Error(`${reasons[reason]}. Чтение нужно повторить позже.`),
    { code, details: { readFailure: { reason, ...position } } })
}
export function listReadDiagnostic(error: any): string | undefined {
  const failure = error?.details?.readFailure
  if (!failure || typeof failure.reason !== 'string' || !Object.hasOwn(reasons, failure.reason)) return undefined
  const position = ['page', 'offset', 'item', 'total', 'observed'].flatMap(key =>
    Number.isSafeInteger(failure[key]) && failure[key] >= 0 ? [`${key}=${failure[key]}`] : [])
  return [failure.reason, ...position].join('; ')
}
export function listReadMessage(error: any): string | undefined {
  return listReadDiagnostic(error) ? `${reasons[error.details.readFailure.reason as keyof typeof reasons]}. Повторим чтение после паузы.` : undefined
}
