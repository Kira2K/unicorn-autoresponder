export function telegramInputValue(value) {
  return '@' + String(value ?? '').trim().replace(/@/g, '')
}

export function phoneInputValue(value, platform) {
  let digits = String(value ?? '').replace(/[^0-9]/g, '')
  if (platform === 'phone_ru' && /^8[0-9]{10}$/.test(digits)) digits = '7' + digits.slice(1)
  return '+' + digits
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
