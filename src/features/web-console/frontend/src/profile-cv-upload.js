export const PDF_MIME = 'application/pdf'
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MAX_BYTES = 20 * 1024 * 1024

export function cvMime(file) {
  if ([PDF_MIME, DOCX_MIME].includes(file?.type)) return file.type
  const name = String(file?.name || '').toLowerCase()
  if (name.endsWith('.pdf')) return PDF_MIME
  if (name.endsWith('.docx')) return DOCX_MIME
  return ''
}

export function cvUploadError(file) {
  if (!file?.size) return 'Файл CV пуст.'
  if (file.size > MAX_BYTES) return 'CV превышает 20 МБ.'
  if (!cvMime(file)) return 'Выберите CV в формате PDF или DOCX.'
  return ''
}
