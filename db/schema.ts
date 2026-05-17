const SHEET_NAMES = {
  personalData: 'ПЕРС ДАННЫЕ',
  dolphinMain: 'Dolphin main',
  stacks: 'Стеки'
} as const

const SHEET_LABELS = {
  name: 'имя',
  fullName: 'ФИО',
  realData: 'Реальные данные',
  stack: 'стек',
  dolphinMainStack: 'СТЕК',
  market: 'рынок',
  telegram: 'ТГ',
  commonChatId: 'Id общего чата',
  dolphinMainTelegramId: 'ТГ id',
  ruResponses: 'Делаем отклики Ru',
  enResponses: 'Делаем отклики En',
  dolphinProfileRuId: 'Dolphin Profile Ru Id',
  dolphinProfileEnId: 'Dolphin Profile En Id',
  proxyRu: 'Прокси Ru',
  proxyEn: 'Прокси En',
  hhRuSection: 'ruHH',
  hhEnSection: 'enHH',
  hhMoscowSection: 'MoscowHH',
  hhInternationalSection: 'InternationalHH',
  hhPhone: 'rusPhoneNumber',
  hhEmail: 'emailHH',
  hhEmailPassword: 'passwordEmailHH',
  hhPassword: 'passwordHH',
  coverRu: 'Сопровод Ru',
  coverEn: 'Сопровод En'
} as const

function getMarketProfileIdLabel(market: 'Ru' | 'En'): string {
  return market === 'Ru'
    ? SHEET_LABELS.dolphinProfileRuId
    : SHEET_LABELS.dolphinProfileEnId
}

function getMarketProxyLabel(market: 'Ru' | 'En'): string {
  return market === 'Ru' ? SHEET_LABELS.proxyRu : SHEET_LABELS.proxyEn
}

module.exports = {
  SHEET_LABELS,
  SHEET_NAMES,
  getMarketProfileIdLabel,
  getMarketProxyLabel
}
