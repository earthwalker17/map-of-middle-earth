<#
.SYNOPSIS
  An unattended film render (S6): `pnpm film --render --budget 0` in its own window, resumed after a failure.

.DESCRIPTION
  Runs the chunked, resumable film render with no time budget (Chrome restarts every 25 min inside the process)
  and, if an attempt exits non-zero (low memory, a crash, a page error), waits and resumes the same run, up to
  -Retries times. Holds a keep-awake request for the whole time (also between attempts); the lid still sleeps.
  Everything is appended to <Run>\render.log (UTF-8). The run's own settings (run.json) win on resume, so
  -FilmArgs only matter for the first attempt of a new run.

  Exit 2 from the render (the run refuses: another film hash, changed render inputs, a dirty tree, another
  Chrome) is not retried.

.EXAMPLE
  # from the repo root, in a separate window. -FilmArgs must be bound with a colon: Start-Process joins its
  # arguments unquoted, and pwsh -File would read a separate '--tier ...' value as parameters.
  Start-Process pwsh -ArgumentList '-NoExit','-File','tools\capture\film-overnight.ps1','-Run','renders\film\final-1080p',
    '-Chrome',"$env:LOCALAPPDATA\map-of-middle-earth\chrome-154.0.8037.95\chrome.exe",
    '-FilmArgs:"--tier final --spp 12 --spp-ladder 36:16,48:24,72:32,96:48 --shutter 0.5 --label final-1080p"'
#>
param(
  [Parameter(Mandatory)] [string] $Run,
  [string] $FilmArgs = '',
  [string] $Chrome = '',
  [int] $Retries = 8,
  [int] $WaitS = 120
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
Set-Location (Resolve-Path "$PSScriptRoot\..\..")

New-Item -ItemType Directory -Force -Path $Run | Out-Null
$log = Join-Path $Run 'render.log'
function Log([string] $m) { $line = "[overnight $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m"; Write-Host $line -ForegroundColor Cyan; Add-Content -LiteralPath $log -Value $line -Encoding utf8 }

if ($Chrome) {
  if (-not (Test-Path -LiteralPath $Chrome)) { throw "Chrome not found: $Chrome" }
  $env:MOME_CHROME = $Chrome
}

# keep the system awake for the whole job, also between attempts (this thread holds the request);
# 2147483649 = ES_CONTINUOUS | ES_SYSTEM_REQUIRED (a hex literal would be a negative Int32 here)
Add-Type -Namespace MoMe -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
if ([MoMe.Power]::SetThreadExecutionState(2147483649) -eq 0) { Log 'WARNING: keep-awake request failed' }

$extra = @(if ($FilmArgs) { $FilmArgs -split '\s+' | Where-Object { $_ } })
$code = -1
# the render's stderr goes to the log too; it must never abort this loop
$ErrorActionPreference = 'Continue'
try {
  for ($attempt = 1; $attempt -le $Retries + 1; $attempt++) {
    $host.UI.RawUI.WindowTitle = "MoMe film render · attempt $attempt · $Run"
    Log "attempt ${attempt}: pnpm film --render --run $Run --budget 0 $($extra -join ' ')$(if ($Chrome) { " (MOME_CHROME=$Chrome)" })"
    pnpm film --render --run $Run --budget 0 @extra 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append
    $code = $LASTEXITCODE
    Log "attempt $attempt exited $code"
    if ($code -eq 0) { break }
    if ($code -eq 2) { Log 'the run refuses to resume (see above): not retrying'; break }
    if ($attempt -le $Retries) { Log "waiting $WaitS s, then resuming"; Start-Sleep -Seconds $WaitS }
  }
} finally {
  [void][MoMe.Power]::SetThreadExecutionState(2147483648)
  $host.UI.RawUI.WindowTitle = "MoMe film render · exit $code · $Run"
  Log "done: exit $code"
}
exit $code
