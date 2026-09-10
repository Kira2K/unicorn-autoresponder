// Keep missing date parts missing; selection never supplies an invented month or year.
export function splitProfileDate(value) {
  const text = String(value ?? '')
  const match = /^(\d*)(?:-(\d{2}))?$/.exec(text)
  return { year: match?.[1] || '', month: match?.[2] || '', current: text === 'present' }
}
export function joinProfileDate({ year, month, current }) {
  return current ? 'present' : `${year || ''}${month ? `-${month}` : ''}`
}
export function completeProfileDate(value, allowCurrent = false) {
  return allowCurrent && value === 'present' || /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(value)
}
