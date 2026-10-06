param(
  [string]$AutoresponsesRepo = 'C:\Users\Administrator\Downloads\hh-autoparcer\hh-autoparcer'
)

$ErrorActionPreference = 'Stop'
$exitCode = 0
$originalLocation = Get-Location

try {
  Set-Location -LiteralPath $AutoresponsesRepo

  if ((Get-Date).DayOfWeek -notin @('Monday', 'Tuesday', 'Wednesday', 'Thursday')) {
    Write-Host 'Skipping HH autoresponses: scheduled runs are allowed Monday-Thursday only.'
    exit 0
  }

  $storage = & node (Join-Path $PSScriptRoot 'hh-autoresponses-storage.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve HH autoresponses storage.' }
  $env:APP_DB = $storage.Trim()

  $stateCheck = Join-Path $AutoresponsesRepo 'scripts\hh-autoresponses-state-check.ps1'
  if (Test-Path -LiteralPath $stateCheck) {
    & $stateCheck `
      -RepoRoot $AutoresponsesRepo `
      -Phase 'launch-time' `
      -CheckPrecheckTask `
      -LaunchTaskName 'HH-Autoresponses-Daily' `
      -PrecheckTaskName 'HH-Autoresponses-Precheck-Daily' `
      -LaunchScriptRelative 'scripts\run-hh-autoresponses-daily.ps1' `
      -PrecheckScriptRelative 'scripts\run-hh-autoresponses-precheck-daily.ps1' `
      -OutLogRelative 'logs\scheduled-launch-state-check-daily.out.log' `
      -ErrLogRelative 'logs\scheduled-launch-state-check-daily.err.log' `
      -LaunchDisplay 'recurring Monday-Thursday 04:40 GMT+3 / 03:40 Europe/Warsaw'
    if ($LASTEXITCODE -ne 0) {
      throw "Launch-time HH state check failed with exit code $LASTEXITCODE."
    }
  }
  else {
    throw "Launch-time HH state check script is missing: $stateCheck"
  }

  $env:ORCHESTRATOR_SUPERVISED = 'true'
  $env:ORCHESTRATOR_CONCURRENCY = '3'
  $env:ORCHESTRATOR_RESPONSE_LIMIT = '120'
  $env:ORCHESTRATOR_WATCH_MS = '7200000'
  $env:ORCHESTRATOR_IDLE_TIMEOUT_MS = '600000'
  Remove-Item Env:ORCHESTRATOR_CLIENT_IDS -ErrorAction SilentlyContinue
  Remove-Item Env:ORCHESTRATOR_CLIENT_NAMES -ErrorAction SilentlyContinue
  Remove-Item Env:ORCHESTRATOR_EXCLUDE_CLIENT_IDS -ErrorAction SilentlyContinue
  Remove-Item Env:ORCHESTRATOR_EXCLUDE_CLIENT_NAMES -ErrorAction SilentlyContinue
  Remove-Item Env:ORCHESTRATOR_EXTRA_BLOCKED_COMPANIES -ErrorAction SilentlyContinue

  foreach ($market in @('Ru', 'En')) {
    try {
      $env:ORCHESTRATOR_WORK_WITH_MARKET = $market
      & npm run orchestrator
      if ($LASTEXITCODE -ne 0) {
        if ($exitCode -eq 0) {
          $exitCode = $LASTEXITCODE
        }
        Write-Warning "$market autoresponses failed with exit code $LASTEXITCODE"
      }
    }
    catch {
      if ($exitCode -eq 0) {
        $exitCode = 1
      }
      Write-Warning "$market autoresponses failed: $($_.Exception.Message)"
    }
  }
}
finally {
  Remove-Item Env:ORCHESTRATOR_WORK_WITH_MARKET -ErrorAction SilentlyContinue
  Set-Location -LiteralPath $originalLocation
}

exit $exitCode
