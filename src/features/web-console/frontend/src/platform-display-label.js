const labels = {
  email_ru: 'Email для ру рынка',
  email_en: 'Email для зарубежного рынка',
  phone_ru: 'Телефон для ру рынка',
  phone_en: 'Телефон для зарубежного рынка',
  telegram_ru: 'Telegram для ру рынка',
  telegram_en: 'Telegram для зарубежного рынка',
  hh_ru: 'HH для ру рынка',
  hh_en: 'HH для зарубежного рынка',
  linkedin: 'LinkedIn',
  github: 'GitHub'
}

// Display only: keep canonical platform codes in forms, policies and API payloads.
export function platformDisplayLabel(value) {
  const text = String(value ?? '')
  return labels[text.trim().toLowerCase()] ?? text
}
