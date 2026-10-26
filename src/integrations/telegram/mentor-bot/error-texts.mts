/** Approved copy. Do not interpolate card data or raw external errors into these messages. */
export const ERROR_TEXTS = Object.freeze({
  studentUnresolved: 'Не удалось однозначно определить ученика этого чата. Обратись к @veu_support.',
  accessDenied: 'Это действие недоступно для твоей роли.',
  accessUnavailable: 'Сейчас не удалось проверить доступ. Попробуй чуть позже.',
  studentUsernameInvalid: 'В карточке ученика не указан корректный Telegram username. Обратись к @veu_support. Изменения недоступны.',
  saveFailed: 'Не удалось сохранить изменения. Попробуй ещё раз.',
  saveUncertain: 'Не удалось проверить, сохранились ли изменения. Открой действие заново и проверь текущие данные.',
  dataChanged: 'Данные изменились. Открой действие заново и подтверди выбор.',
  screenStale: 'Этот экран устарел. Открой действие через главное меню.',
  backgroundFailed: 'Не удалось выполнить фоновую проверку. Бот продолжает обработку новых сообщений. Обратись к @veu_support.'
} as const);
export type ErrorKey = keyof typeof ERROR_TEXTS;
