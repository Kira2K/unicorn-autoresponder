const MAX_PROFILE_FILE_BYTES = 250_000

export async function readProfileFile(file) {
  if (!file || !String(file.name).toLowerCase().endsWith('.json')) {
    throw new Error('Choose a .json file.')
  }
  if (!file.size || file.size > MAX_PROFILE_FILE_BYTES) {
    throw new Error('The JSON file must be between 1 byte and 250 KB.')
  }
  const text = await file.text()
  try { JSON.parse(text) }
  catch { throw new Error('The selected file contains invalid JSON.') }
  return { name: file.name, size: file.size, text }
}

export function fileSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

export function downloadProfileFile(document) {
  const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = Object.assign(window.document.createElement('a'), {
    href: url, download: 'profile.normalized.json'
  })
  link.click()
  URL.revokeObjectURL(url)
}
