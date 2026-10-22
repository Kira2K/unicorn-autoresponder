param([switch]$Check, [switch]$Background)
$ErrorActionPreference = 'Stop'
$bridgeNode = Get-Command node -ErrorAction Stop
$bridgeArguments = @((Join-Path $PSScriptRoot 'cli.mjs'))
if ($Check) { $bridgeArguments += '--check' }
if ($Background) {
  if ($Check) { throw 'Choose either -Check or -Background' }
  $bridgeStatePath = Join-Path $PSScriptRoot '.state'
  New-Item -ItemType Directory -Path $bridgeStatePath -Force | Out-Null
  $bridgeProcess = Start-Process -FilePath $bridgeNode.Source -ArgumentList @('"' + (Join-Path $PSScriptRoot 'cli.mjs') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bridgeStatePath 'stdout.log') -RedirectStandardError (Join-Path $bridgeStatePath 'stderr.log') -PassThru
  Write-Output "Octo bridge started, PID $($bridgeProcess.Id). Stop with: node cli.mjs --stop"
  exit 0
}
& $bridgeNode.Source @bridgeArguments
exit $LASTEXITCODE
