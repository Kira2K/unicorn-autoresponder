export function telegramInputValue(value) {
  return '@' + String(value ?? '').trim().replace(/@/g, '')
}

export function phoneInputValue(value, _platform) {
  return '+' + String(value ?? '').replace(/[^0-9]/g, '')
}

export function phonePayload(value, platform) {
  const phone = phoneInputValue(value, platform)
  return phone === '+' ? '' : phone
}

export function isAccountPhoneField(field, platform) {
  return field === 'phone' || field === 'foreignNumber'
    || (field === 'login' && ['telegram_ru', 'telegram_en'].includes(platform))
}

// Capture before PrimeVue reads the native value, including when filtering
// leaves the model unchanged or the user deletes the automatic prefix.
export function updateContactInput(event, format) {
  const input = event.target
  const raw = input.value
  const caret = input.selectionStart ?? raw.length
  const value = format(raw)
  input.value = value
  const nextCaret = Math.min(value.length, Math.max(1, format(raw.slice(0, caret)).length))
  input.setSelectionRange(nextCaret, nextCaret)
  return value
}
