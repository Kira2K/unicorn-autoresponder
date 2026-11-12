param(
  [string]$AutoresponsesRepo,
  [ValidateRange(1,1000)][int]$ResponseLimit = 100,
  [ValidateRange(1,20)][int]$Concurrency = 4,
  [string]$EnvFile,
  [string]$NodePath = 'node',
  [switch]$AllowWeekend
)
$ErrorActionPreference = 'Stop'
if (!$AutoresponsesRepo) { $AutoresponsesRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$originalLocation = Get-Location
try {
  Set-Location -LiteralPath $AutoresponsesRepo
  $arguments = @((Join-Path $AutoresponsesRepo 'src/features/hh-responses/supervised/cli.cjs'))
  if ($PSBoundParameters.ContainsKey('ResponseLimit')) { $arguments += "--limit=$ResponseLimit" }
  if ($PSBoundParameters.ContainsKey('Concurrency')) { $arguments += "--concurrency=$Concurrency" }
  if ($EnvFile) { $arguments += "--env-file=$([IO.Path]::GetFullPath($EnvFile))" }
  if ($AllowWeekend) { $arguments += '--allow-weekend' }
  & $NodePath @arguments
  $runExit = $LASTEXITCODE
} finally { Set-Location -LiteralPath $originalLocation }
exit $runExit
