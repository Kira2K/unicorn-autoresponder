/** Safe display text shared by the LinkedIn API and UI; no account data or side effects. */
const ERRORS = {
  linkedin_browser_unsupported: {
    message: 'Аккаунт пропущен: нужен профиль Dolphin (En). Octo и другие браузеры пока не подключаются к Unipile.',
    action: 'Проверьте наличие En-профиля Dolphin и его связь с учеником.'
  },
  dolphin_en_profile_not_found: {
    message: 'У ученика не найден профиль Dolphin с языком En. Octo пока не поддерживается; подключение к Unipile не выполняется.',
    action: 'Проверьте наличие профиля Dolphin и его связь с учеником.'
  },
  dolphin_en_profile_ambiguous: {
    message: 'У ученика найдено несколько профилей Dolphin с языком En. Нельзя выбрать профиль для подключения к Unipile.',
    action: 'Уточните привязку: нужен один En-профиль Dolphin для этого ученика.'
  }
}

export function linkedinBrowserErrorDisplay(value: unknown) {
  const code = String(value ?? '').trim().toLowerCase()
  if (!Object.hasOwn(ERRORS, code)) return undefined
  return { code, category: 'Браузер', tone: 'warning' as const, ...ERRORS[code as keyof typeof ERRORS] }
}

export function linkedinBrowserErrorText(value: unknown) {
  const display = linkedinBrowserErrorDisplay(value)
  return display ? `${display.message} ${display.action}` : undefined
}
