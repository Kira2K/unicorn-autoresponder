param(
  [ValidateSet('inspect','full')][string]$Mode = 'inspect',
  [string]$EnvFile,
  [string]$NodePath = 'node'
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$arguments = @((Join-Path $repoRoot 'src/features/hh-responses/supervised/services-cli.cjs'), "--mode=$Mode")
if ($EnvFile) { $arguments += "--env-file=$([IO.Path]::GetFullPath($EnvFile))" }
$oldLocation = Get-Location
try {
  Set-Location -LiteralPath $repoRoot
  & $NodePath @arguments
  exit $LASTEXITCODE
} finally { Set-Location -LiteralPath $oldLocation }
