// Existing values remain visible until edited; opening a form does not rewrite them.
export function usernameDisplay(value) {
  return '@' + String(value ?? '').replace(/@/g, '')
}

export function updateUsernameInput(event) {
  const input = event.target
  const raw = input.value
  const caret = input.selectionStart ?? raw.length
  const value = '@' + raw.replace(/[^a-zA-Z0-9_]/g, '')
  const nextCaret = 1 + raw.slice(0, caret).replace(/[^a-zA-Z0-9_]/g, '').length
  // Write to the element too: Vue may skip an update when a rejected character
  // leaves the model unchanged (including deleting the prefix).
  input.value = value
  input.setSelectionRange(nextCaret, nextCaret)
  return value
}

export function usernamePayload(value) {
  const display = usernameDisplay(value)
  if (display === '@') return ''
  if (!/^@[a-zA-Z0-9_]+$/.test(display)) {
    throw new Error('Username: допускаются латинские буквы A–Z, a–z, цифры 0–9 и «_» после @')
  }
  return display
}
