$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This verification requires Windows.' }
$auditEvidence = if ($env:LOGLENS_EVIDENCE_DIR) { $env:LOGLENS_EVIDENCE_DIR } else { Join-Path (Get-Location) 'evidence\stage-3' }
New-Item -ItemType Directory -Path $auditEvidence -Force | Out-Null
$auditRoot = Join-Path ([IO.Path]::GetTempPath()) ('loglens-acl-audit-' + [Guid]::NewGuid().ToString('N'))
$auditRoot = [IO.Path]::GetFullPath($auditRoot)
if ([IO.Path]::GetDirectoryName($auditRoot) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')) { throw 'Unsafe temporary root.' }
New-Item -ItemType Directory -Path $auditRoot | Out-Null
$auditFile = Join-Path $auditRoot 'synthetic.log'
[IO.File]::WriteAllText($auditFile, "INFO safe`n", [Text.UTF8Encoding]::new($false))
$auditIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$auditOriginalFileAcl = Get-Acl -LiteralPath $auditFile
$auditOriginalRootAcl = Get-Acl -LiteralPath $auditRoot
$auditRows = @()
try {
  $auditFileAcl = Get-Acl -LiteralPath $auditFile
  $auditFileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($auditIdentity, [Security.AccessControl.FileSystemRights]::ReadData, [Security.AccessControl.AccessControlType]::Deny))
  Set-Acl -LiteralPath $auditFile -AclObject $auditFileAcl
  $auditOutput = & node dist/bin.js inspect $auditFile --output-format=json 2> (Join-Path $auditRoot 'input.stderr')
  $auditInputStatus = $LASTEXITCODE
  $auditResult = ($auditOutput -join "`n") | ConvertFrom-Json
  if ($auditInputStatus -ne 4 -or $auditResult.sources[0].errors[0] -ne 'INPUT_PERMISSION' -or $auditResult.stats.eventsRead -ne 0) { throw 'Input ACL assertion failed.' }
  $auditRows += @{ name = 'actual NTFS deny ReadData'; status = 'PASS'; exitCode = $auditInputStatus; observedCode = 'INPUT_PERMISSION' }
  Set-Acl -LiteralPath $auditFile -AclObject $auditOriginalFileAcl
  $auditRootAcl = Get-Acl -LiteralPath $auditRoot
  $auditRootAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($auditIdentity, [Security.AccessControl.FileSystemRights]::CreateFiles, [Security.AccessControl.InheritanceFlags]::None, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Deny))
  Set-Acl -LiteralPath $auditRoot -AclObject $auditRootAcl
  $auditOutput = & node dist/bin.js inspect $auditFile --output-format=json --output (Join-Path $auditRoot 'result.json') 2> (Join-Path $auditEvidence 'acl-output.stderr')
  $auditOutputStatus = $LASTEXITCODE
  if ($auditOutputStatus -ne 4 -or ($auditOutput -join '') -ne '') { throw 'Output ACL assertion failed.' }
  $auditError = Get-Content -LiteralPath (Join-Path $auditEvidence 'acl-output.stderr') -Raw | ConvertFrom-Json
  if ($auditError.code -ne 'UNSAFE_OUTPUT') { throw 'Output ACL code mismatch.' }
  $auditRows += @{ name = 'actual NTFS deny CreateFiles'; status = 'PASS'; exitCode = $auditOutputStatus; observedCode = 'UNSAFE_OUTPUT' }
  Set-Acl -LiteralPath $auditRoot -AclObject $auditOriginalRootAcl
  if (Test-Path -LiteralPath (Join-Path $auditRoot 'result.json')) { throw 'Output unexpectedly committed.' }
  if (Get-ChildItem -LiteralPath $auditRoot -Filter '*.tmp') { throw 'Temporary output leaked.' }
  $auditRedirect = Join-Path $auditRoot 'stdout ação.json'
  'INFO ação' | & node dist/bin.js search - --query ação --output-format=json > $auditRedirect
  if ($LASTEXITCODE -ne 0) { throw 'PowerShell stdin/redirect failed.' }
  $auditNativeText = [IO.File]::ReadAllText($auditRedirect, [Text.Encoding]::UTF8)
  $auditNativeResult = $auditNativeText | ConvertFrom-Json
  if ($auditNativeResult.stats.eventsRead -ne 1 -or $auditNativeResult.events[0].message -ne 'ação' -or $auditNativeText.Contains("`r")) { throw 'PowerShell Unicode/LF assertion failed.' }
  $auditRows += @{ name = 'PowerShell Unicode stdin and native stdout redirection'; status = 'PASS'; exitCode = 0; observed = 'one info event; Unicode preserved; output LF' }
  @{ status = 'PASS'; platform = 'Windows'; powershell = $PSVersionTable.PSVersion.ToString(); checks = $auditRows; nativeCtrlC = 'NOT TESTED'; scope = 'ACL changes limited to test-owned temporary files and directory; originals restored in finally.' } |
    ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $auditEvidence 'windows-acl.json') -Encoding utf8
  Write-Output 'PASS: NTFS input permission failure and output creation failure; no committed/temp output.'
} finally {
  Set-Acl -LiteralPath $auditRoot -AclObject $auditOriginalRootAcl
  Set-Acl -LiteralPath $auditFile -AclObject $auditOriginalFileAcl
  if ([IO.Path]::GetDirectoryName($auditRoot) -ne [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') -or -not [IO.Path]::GetFileName($auditRoot).StartsWith('loglens-acl-audit-')) { throw 'Unsafe cleanup.' }
  Remove-Item -LiteralPath $auditRoot -Recurse -Force
}
