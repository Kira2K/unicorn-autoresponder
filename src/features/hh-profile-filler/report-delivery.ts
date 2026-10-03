import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Persist intent BEFORE sending. A timeout or crash is unknown delivery, never permission to resend.
export async function deliverOnce(operationId: string, text: string, root: string,
  send: (text: string) => Promise<void>): Promise<'sent' | 'already_sent'> {
  if (!operationId) throw new Error('profile_report_operation_id_missing')
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, `${createHash('sha256').update(operationId).digest('hex')}.json`)
  try {
    fs.writeFileSync(file, JSON.stringify({ operationId, status: 'sending', at: new Date().toISOString() }),
      { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (previous.status === 'sent') return 'already_sent'
    throw new Error('profile_report_delivery_unknown')
  }
  await send(text)
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify({ operationId, status: 'sent', at: new Date().toISOString() }),
    { mode: 0o600 })
  fs.renameSync(temporary, file)
  return 'sent'
}
