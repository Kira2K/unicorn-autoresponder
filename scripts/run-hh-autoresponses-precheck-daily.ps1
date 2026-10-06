param(
  [string]$AutoresponsesRepo = 'C:\Users\Administrator\Downloads\hh-autoparcer\hh-autoparcer'
)

$ErrorActionPreference = 'Stop'
$originalLocation = Get-Location

try {
  Set-Location -LiteralPath $AutoresponsesRepo

  if ((Get-Date).DayOfWeek -notin @('Monday', 'Tuesday', 'Wednesday', 'Thursday')) {
    Write-Host 'Skipping HH autoresponses precheck: scheduled runs are allowed Monday-Thursday only.'
    exit 0
  }

  $storage = & node (Join-Path $PSScriptRoot 'hh-autoresponses-storage.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve HH autoresponses storage.' }
  $env:APP_DB = $storage.Trim()

  $stateCheck = Join-Path $AutoresponsesRepo 'scripts\hh-autoresponses-state-check.ps1'
  if (-not (Test-Path -LiteralPath $stateCheck)) {
    throw "Scheduled HH precheck script is missing: $stateCheck"
  }

  & $stateCheck `
    -RepoRoot $AutoresponsesRepo `
    -Phase 'scheduled-t-minus-1h' `
    -CheckPrecheckTask `
    -LaunchTaskName 'HH-Autoresponses-Daily' `
    -PrecheckTaskName 'HH-Autoresponses-Precheck-Daily' `
    -LaunchScriptRelative 'scripts\run-hh-autoresponses-daily.ps1' `
    -PrecheckScriptRelative 'scripts\run-hh-autoresponses-precheck-daily.ps1' `
    -OutLogRelative 'logs\scheduled-precheck-daily.out.log' `
    -ErrLogRelative 'logs\scheduled-precheck-daily.err.log' `
    -LaunchDisplay 'recurring Monday-Thursday 04:40 GMT+3 / 03:40 Europe/Warsaw'

  exit $LASTEXITCODE
}
finally {
  Set-Location -LiteralPath $originalLocation
}
