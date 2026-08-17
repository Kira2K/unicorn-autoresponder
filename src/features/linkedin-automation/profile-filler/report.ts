const fs = require('node:fs')
const path = require('node:path')

type FillResult = import('./types.ts').FillResult
type ProfilePlan = import('./types.ts').ProfilePlan

function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

function writeRunReport(
  directory: string,
  plan: ProfilePlan,
  result?: FillResult
): string {
  fs.mkdirSync(directory, { recursive: true })
  const filePath = path.join(directory, `linkedin-profile-${timestampForFile()}.json`)
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    account_id: plan.account.accountId,
    identity: plan.identity,
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
  }
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return filePath
}

module.exports = {
  timestampForFile,
  writeRunReport
}
