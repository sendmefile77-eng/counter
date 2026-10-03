param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$Report
)
$ErrorActionPreference = 'Stop'
$exePath = (Resolve-Path $Executable).Path
$reportPath = [System.IO.Path]::GetFullPath($Report)
if (Test-Path $reportPath) { Remove-Item $reportPath }
$process = Start-Process -FilePath $exePath -ArgumentList ('"--lad-self-test=' + $reportPath + '"') -PassThru
$deadline = (Get-Date).AddSeconds(120)
while (!(Test-Path $reportPath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (!(Test-Path $reportPath)) { throw 'Packaged application did not write the self-test report within 120 seconds.' }
$result = Get-Content $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
$process.WaitForExit(20000) | Out-Null
if ($result.temporaryDirectory -and ([System.IO.Path]::GetFileName($result.temporaryDirectory)).StartsWith('lad-packaged-test-')) {
  Remove-Item -LiteralPath $result.temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output ($result | ConvertTo-Json -Depth 8)
if ($result.platform -ne 'win32' -or $result.status -ne 'passed') { throw 'Packaged Windows application checks failed; see the JSON report.' }
Write-Output 'Packaged checks passed. Native picker, delivered notifications, second launch and visual inspection still need the manual protocol.'
