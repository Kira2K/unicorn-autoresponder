param(
  [string]$AutoresponsesRepo = 'C:\Users\Administrator\Downloads\hh-autoparcer\hh-autoparcer'
)

$ErrorActionPreference = 'Stop'
$exitCode = 0
$originalLocation = Get-Location

try {
  Set-Location -LiteralPath $AutoresponsesRepo
  $env:APP_DB = 'noco'
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
