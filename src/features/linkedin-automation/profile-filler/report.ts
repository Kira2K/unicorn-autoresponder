const fs = require('node:fs')
const path = require('node:path')
const { NOOP_LOGGER, toSafeErrorMetadata } = require('../core/reporting/logger.ts') as typeof import('../core/reporting/logger.ts')
const { redactObject } = require('../core/safety/redaction.ts') as typeof import('../core/safety/redaction.ts')

type FillResult = import('./types.ts').FillResult
type Logger = import('../core/reporting/logger.ts').Logger
type ProfilePlan = import('./types.ts').ProfilePlan

function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

function writeRunReport(
  directory: string,
  plan: ProfilePlan,
  result?: FillResult,
  logger: Logger = NOOP_LOGGER,
): string {
  const scopedLogger = logger.child({ accountId: plan.account.accountId })
  scopedLogger.info('report.write_started', 'Начата запись локального отчёта.', {
    stepCount: plan.steps.length,
    hasResult: result !== undefined,
  })
  try {
    fs.mkdirSync(directory, { recursive: true })
    const filePath = path.join(directory, `linkedin-profile-${timestampForFile()}.json`)
    const report = redactObject({
      schema_version: 1,
      generated_at: new Date().toISOString(),
      account_id: plan.account.accountId,
      identity: plan.identity,
      source_snapshot: plan.sourceSnapshot,
      warnings: plan.issues,
      planned_steps: plan.steps.map(step => ({
        id: step.id,
        section: step.section,
        action: step.action,
        summary: step.summary,
        before: step.before,
        after: step.after
      })),
      result
    })
    fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    scopedLogger.info('report.write_completed', 'Локальный отчёт записан.', {
      fileName: path.basename(filePath),
    })
    return filePath
  } catch (error: unknown) {
    scopedLogger.error('report.write_failed', 'Не удалось записать локальный отчёт.', toSafeErrorMetadata(error))
    throw error
  }
}

module.exports = {
  timestampForFile,
  writeRunReport
}
