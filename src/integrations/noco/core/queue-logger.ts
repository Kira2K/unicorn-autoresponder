const fs = require('node:fs')
const path = require('node:path')

type QueueEvent = {
  event: string
  kind?: 'read' | 'write'
  queueDepth?: number
  waitMs?: number
  durationMs?: number
  status?: number
  errorCode?: string
  waitReason?: 'batch_pause' | 'rate_limit' | null
  completedInBatch?: number
  requestInBatch?: number
}

function createNocoQueueLogger(options: {
  directory?: string
  writeLine?: (line: string) => void
} = {}) {
  const directory = options.directory ?? path.resolve(__dirname, '../../../../logs/noco-queue')
  const file = path.join(directory, `noco-queue-${process.pid}.jsonl`)
  const writeLine = options.writeLine ?? ((line: string) => {
    fs.mkdirSync(directory, { recursive: true })
    fs.appendFileSync(file, `${line}\n`, 'utf8')
  })

  return (event: QueueEvent) => {
    try {
      writeLine(JSON.stringify({ at: new Date().toISOString(), ...event }))
    } catch {}
  }
}

module.exports = { createNocoQueueLogger }
export type { QueueEvent }
