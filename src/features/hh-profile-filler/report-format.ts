import type { ProfileFillerResult } from './types.ts'
import { assertTerminalSuccess } from './contract.ts'
import { safeErrorMessage } from './errors.ts'

const oneLine = (value: string) => value.trim().replace(/\s+/g, ' ')
export function formatProfileFillerReport(result: ProfileFillerResult): string {
  if (result.ok) assertTerminalSuccess(result)
  const profile = result.dolphinProfileName ? oneLine(result.dolphinProfileName) :
    'не определён; заполнение не начиналось'
  const header = `${result.ok ? '✅' : '⚠️'} HH Profile Filler\nПрофиль Dolphin: ${profile}`
  if (result.ok) {
    const contactWarnings = result.contractVerification?.filter(item => item.checks?.contacts.status === 'warning').length ?? 0
    return `${header}\nПолучилось заполнить.` + (contactWarnings
      ? `\n⚠️ Контакты: проверка не подтверждена в ${contactWarnings} резюме; заполнение продолжено.` : '')
  }
  let reason = oneLine(safeErrorMessage(result.message)) || 'Неизвестная ошибка'
  const clientName = oneLine(result.clientName ?? '')
  if (clientName) {
    const escaped = clientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    reason = reason.replace(new RegExp(escaped, 'gi'), '[клиент]')
  }
  const prefix = `${header}\nНе получилось заполнить.\nПричина: `
  return prefix + reason.slice(0, Math.max(0, 3900 - prefix.length))
}
