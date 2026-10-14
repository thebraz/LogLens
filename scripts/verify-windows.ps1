param([string]$NodeHeaders = '')
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Execute este roteiro no PowerShell 7 do Windows.' }
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if ((& node --version) -notmatch '^v24\.') { throw 'Node.js 24.x é obrigatório.' }
function Invoke-LogLensNpm {
  param([string[]]$Arguments)
  & npm @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Gate npm falhou: $($Arguments -join ' ')" }
}
$previousHeaders = $env:LOGLENS_NODE_HEADERS
try {
  if ($NodeHeaders) { $env:LOGLENS_NODE_HEADERS = (Resolve-Path -LiteralPath $NodeHeaders).Path }
  Invoke-LogLensNpm -Arguments @('ci', '--ignore-scripts', '--no-audit', '--no-fund')
  Invoke-LogLensNpm -Arguments @('run', 'build:native')
  Invoke-LogLensNpm -Arguments @('run', 'check')
  Invoke-LogLensNpm -Arguments @('run', 'verify:release-docs')
  Invoke-LogLensNpm -Arguments @('run', 'security:filesystem')
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'audit-windows.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Gate ACL Windows falhou.' }
  & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'audit-windows-console.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Gate Ctrl+C Windows falhou.' }
  Invoke-LogLensNpm -Arguments @('audit', '--ignore-scripts')
  Invoke-LogLensNpm -Arguments @('run', 'verify:package')
  Write-Host 'Verificações locais concluídas. Isso não aprova os gates Linux/macOS, desempenho dedicado, CI ou publicação.'
} finally { $env:LOGLENS_NODE_HEADERS = $previousHeaders }
