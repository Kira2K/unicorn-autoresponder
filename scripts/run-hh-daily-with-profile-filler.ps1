param(
  [string]$AutoresponsesRepo = 'C:\Users\Administrator\Downloads\hh-autoparcer\hh-autoparcer',
  [string]$ProfileFillerRepo = 'C:\Users\Administrator\Downloads\hh-autoparcer\hh-autoparcer\.tmp\hh-profile-filling'
)

$ErrorActionPreference = 'Stop'
$autoresponsesExit = 0
$profileFillerExit = 0
$originalLocation = Get-Location

try {
  Set-Location -LiteralPath $AutoresponsesRepo
  foreach ($market in @('Ru', 'En')) {
    try {
      $env:ORCHESTRATOR_WORK_WITH_MARKET = $market
      & npm run orchestrator
      if ($LASTEXITCODE -ne 0) {
        if ($autoresponsesExit -eq 0) {
          $autoresponsesExit = $LASTEXITCODE
        }
        Write-Warning "$market autoresponses failed with exit code $LASTEXITCODE"
      }
    }
    catch {
      if ($autoresponsesExit -eq 0) {
        $autoresponsesExit = 1
      }
      Write-Warning "$market autoresponses failed: $($_.Exception.Message)"
    }
  }
}
catch {
  if ($autoresponsesExit -eq 0) {
    $autoresponsesExit = 1
  }
  Write-Warning "HH autoresponses failed: $($_.Exception.Message)"
}
finally {
  try {
    Remove-Item Env:ORCHESTRATOR_WORK_WITH_MARKET -ErrorAction SilentlyContinue
    $env:PROFILE_FILLER_STORAGE_ROOT = Join-Path $AutoresponsesRepo 'storage\hh-profile-filler'
    $env:PROFILE_FILLER_ARTIFACT_ROOT = Join-Path $AutoresponsesRepo 'logs\hh-profile-filler'
    Set-Location -LiteralPath $AutoresponsesRepo
    $profileFillerCli = Join-Path $ProfileFillerRepo 'src\features\hh-profile-filler\cli.ts'
    & node $profileFillerCli --pending
    $profileFillerExit = $LASTEXITCODE
  }
  catch {
    $profileFillerExit = 1
    Write-Error "HH Profile Filler failed to start: $($_.Exception.Message)"
  }
  finally {
    Set-Location -LiteralPath $originalLocation
  }
}

if ($profileFillerExit -ne 0) {
  exit $profileFillerExit
}
exit $autoresponsesExit
