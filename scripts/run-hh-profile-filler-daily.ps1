param(
  [string]$RuntimeRepo = 'C:\Users\Administrator\Downloads\hh-autoparcer\hh-autoparcer',
  [string]$ProfileFillerRepo = 'C:\Users\Administrator\Downloads\hh-autoparcer\hh-autoparcer\.tmp\hh-profile-filling'
)

$ErrorActionPreference = 'Stop'
$exitCode = 0
$originalLocation = Get-Location

try {
  $env:PROFILE_FILLER_STORAGE_ROOT = Join-Path $RuntimeRepo 'storage\hh-profile-filler'
  $env:PROFILE_FILLER_ARTIFACT_ROOT = Join-Path $RuntimeRepo 'logs\hh-profile-filler'
  Remove-Item Env:main_messenger_telegram_session -ErrorAction SilentlyContinue
  $env:TELEGRAM_STORAGE_ROOT = Join-Path $RuntimeRepo 'storage'
  $telegramSessionFile = Join-Path $env:TELEGRAM_STORAGE_ROOT `
    'telegram-reporting\.telegram-session'
  if (-not (Test-Path -LiteralPath $telegramSessionFile)) {
    throw "Telegram reporting session was not found: $telegramSessionFile"
  }
  Set-Location -LiteralPath $RuntimeRepo
  $profileFillerCli = Join-Path $ProfileFillerRepo 'src\features\hh-profile-filler\cli.ts'
  if (-not (Test-Path -LiteralPath $profileFillerCli)) {
    throw "HH Profile Filler CLI was not found: $profileFillerCli"
  }
  & node $profileFillerCli --pending
  $exitCode = $LASTEXITCODE
}
catch {
  $exitCode = 1
  Write-Error "HH Profile Filler failed: $($_.Exception.Message)"
}
finally {
  Set-Location -LiteralPath $originalLocation
}

exit $exitCode
