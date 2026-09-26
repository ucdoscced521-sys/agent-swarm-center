#Requires -Version 5.1
<#
.SYNOPSIS
  Non-interactive GitHub upload: device-code OAuth (no TTY needed) + create repo + push.

.DESCRIPTION
  WHY THIS EXISTS
  `gh auth login --web` needs a TTY. In a sandboxed or output-redirected shell it dies with
  "unexpected EOF" / "context deadline exceeded" before the one-time code can be used, and the
  code is copied to the clipboard but the process is already gone.
  This script drives GitHub's OAuth device flow itself:

    1. POST https://github.com/login/device/code   -> prints USER CODE + verification URL
    2. poll https://github.com/login/oauth/access_token until you authorize in the browser
    3. gh auth login --with-token                  -> stores the credential (works without TTY)
    4. gh repo create (optional) + git push HEAD --tags

  The token is written to a file and piped into gh. IT IS NEVER PRINTED.
  The client_id used is GitHub CLI's own public client id (the same one gh itself uses).

.PARAMETER RepoName
  Target repository name. Default: agent-swarm-center

.PARAMETER Visibility
  private (default) or public.

.PARAMETER CreateRepo
  Create the repo via the API if it does not exist yet.

.PARAMETER RepoPath
  Local git repository to upload. Default: current directory.

.PARAMETER Proxy
  HTTP proxy for GitHub endpoints and git. Default: http://127.0.0.1:7897
  Pass -Proxy "" to go direct.

.PARAMETER TimeoutSeconds
  How long to wait for authorization. Default 900 (GitHub's code lifetime).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gh-device-auth.ps1 `
      -RepoName agent-swarm-center -CreateRepo

.NOTES
  Exit codes: 0 ok | 1 usage/env error | 2 not authorized (timeout / denied) | 3 push failed
#>
[CmdletBinding()]
param(
    [string]$RepoName = 'agent-swarm-center',
    [ValidateSet('private', 'public')][string]$Visibility = 'private',
    [switch]$CreateRepo,
    [string]$RepoPath = (Get-Location).Path,
    [string]$Proxy = 'http://127.0.0.1:7897',
    [string]$ClientId = '178c6fc778ccc68e1d6a',
    [string]$Scope = 'repo read:org',
    [int]$TimeoutSeconds = 900,
    [switch]$Resume,
    [string]$LogFile = ''
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

if ([string]::IsNullOrWhiteSpace($LogFile)) {
    $LogFile = Join-Path $env:TEMP 'gh-device-auth.log'
}
function Say($m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}
function Die($m, $code) { Say ("FAIL: " + $m); exit $code }

'' | Set-Content -Path $LogFile -Encoding UTF8
Say "=== gh-device-auth start ==="
Say ("RepoPath   = " + $RepoPath)
Say ("RepoName   = " + $RepoName + "  (" + $Visibility + ")")
Say ("Proxy      = " + $(if ($Proxy) { $Proxy } else { '<direct>' }))

# ---------- 0. locate gh ----------
$ghExe = $null
$portable = Join-Path $env:LOCALAPPDATA 'gh-portable\bin\gh.exe'
if (Test-Path $portable) { $ghExe = $portable }
if (-not $ghExe) {
    $cmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($cmd) { $ghExe = $cmd.Source }
}
if (-not $ghExe) { Die "gh CLI not found (install portable gh or add it to PATH)" 1 }
Say ("gh         = " + $ghExe)

# ---------- 1. env for gh / git ----------
if ($Proxy) {
    $env:HTTPS_PROXY = $Proxy
    $env:HTTP_PROXY = $Proxy
    $env:NO_PROXY = ''
}

# ---------- 2. already authenticated? ----------
$hostsYml = Join-Path $env:APPDATA 'GitHub CLI\hosts.yml'
$needLogin = $true
if (Test-Path $hostsYml) {
    $st = (& $ghExe auth status 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0) {
        $needLogin = $false
        Say 'gh already authenticated, skipping device flow'
    } else {
        Say 'gh hosts.yml present but auth status failed; re-running device flow'
    }
}

$token = $null

if ($needLogin) {
    # ---------- 3. obtain the device code ----------
    # Two-phase mode: run once WITHOUT -Resume to get a code, show it to the human,
    # and once WITH -Resume (after they authorized) to exchange it. This keeps the
    # process short-lived: long-running pollers get reaped by sandboxed hosts, and a
    # reaped poller means a dead device code.
    $codeFile = Join-Path $env:TEMP 'gh-device.json'
    $dc = $null

    if ($Resume) {
        if (-not (Test-Path $codeFile)) {
            Die ("-Resume given but no saved device code at " + $codeFile + " - run once without -Resume first") 1
        }
        try { $dc = (Get-Content -Path $codeFile -Raw) | ConvertFrom-Json } catch { $dc = $null }
        if (-not $dc -or -not $dc.device_code) {
            Die 'saved device code is unreadable; run again without -Resume to get a fresh one' 1
        }
        Say 'resuming with saved device code (no new code requested)'
    } else {
        $curlArgs = @('-s', '-X', 'POST', 'https://github.com/login/device/code',
            '-H', 'Accept: application/json',
            '-H', 'User-Agent: gh-cli',
            '-d', ("client_id={0}&scope={1}" -f $ClientId, [uri]::EscapeDataString($Scope)),
            '--max-time', '45')
        if ($Proxy) { $curlArgs = @('--proxy', $Proxy) + $curlArgs }

        $resp = (& curl.exe @curlArgs 2>&1 | Out-String)
        try { $dc = $resp | ConvertFrom-Json } catch { $dc = $null }
        if (-not $dc -or -not $dc.device_code) {
            Die ("could not obtain device code. raw response: " + ($resp -replace '\s+', ' ')) 1
        }
        [System.IO.File]::WriteAllText($codeFile, ($dc | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
        Say ("device code saved to " + $codeFile + " (use -Resume after authorizing)")
    }

    Say '--------------------------------------------------------------'
    Say ("OPEN THIS URL : " + $dc.verification_uri)
    Say ("ENTER THE CODE: " + $dc.user_code)
    Say ("(code expires in " + $dc.expires_in + " seconds)")
    Say '--------------------------------------------------------------'

    # ---------- 4. poll for the access token ----------
    $interval = 5
    if ($dc.interval) { $interval = [int]$dc.interval }
    $deadline = (Get-Date).AddSeconds([Math]::Min($TimeoutSeconds, [int]$dc.expires_in))
    $ok = $false

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds $interval
        $pollArgs = @('-s', '-X', 'POST', 'https://github.com/login/oauth/access_token',
            '-H', 'Accept: application/json',
            '-H', 'User-Agent: gh-cli',
            '-d', ("client_id={0}&device_code={1}&grant_type=urn:ietf:params:oauth:grant-type:device_code" -f $ClientId, $dc.device_code),
            '--max-time', '45')
        if ($Proxy) { $pollArgs = @('--proxy', $Proxy) + $pollArgs }

        $pr = (& curl.exe @pollArgs 2>&1 | Out-String)
        $pj = $null
        try { $pj = $pr | ConvertFrom-Json } catch { $pj = $null }
        if (-not $pj) { continue }

        if ($pj.access_token) { $token = $pj.access_token; $ok = $true; break }
        $err = $pj.error
        if ($err -eq 'authorization_pending') { continue }
        if ($err -eq 'slow_down') { $interval = $interval + 5; continue }
        if ($err -eq 'expired_token') { Die 'device code expired before authorization' 2 }
        if ($err -eq 'access_denied') { Die 'authorization was denied in the browser' 2 }
        Say ("poll error: " + ($pr -replace '\s+', ' '))
    }

    if (-not $ok) { Die 'timed out waiting for authorization' 2 }
    Say 'authorization received (token captured, not printed)'

    # ---------- 5. hand the token to gh (stdin, non-interactive) ----------
    $tokenFile = Join-Path $env:TEMP 'gh-token.txt'
    Set-Content -Path $tokenFile -Value $token -Encoding ASCII -NoNewline
    $env:GH_TOKEN = $token
    $login = (Get-Content -Path $tokenFile -Raw) | & $ghExe auth login --hostname github.com --with-token 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Say ("gh auth login output: " + ($login -replace '\s+', ' ')) }
    $st2 = (& $ghExe auth status 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { Die 'gh auth status still failing after login' 2 }
    Say 'gh authenticated'
    Remove-Item -Path $tokenFile -Force -ErrorAction SilentlyContinue
    Say 'temporary token file removed (credential now lives in gh hosts.yml only)'
}

# ---------- 6. git: proxy + identity ----------
if ($Proxy) {
    & git -C $RepoPath config http.proxy $Proxy  | Out-Null
    & git -C $RepoPath config https.proxy $Proxy | Out-Null
    Say ("git proxy set (repo scope) = " + $Proxy)
}
$head = (& git -C $RepoPath rev-parse --verify HEAD 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Die 'repository has no commit yet' 1 }
Say ("HEAD = " + $head)

# ---------- 7. create repo + push ----------
if (-not $token) {
    # authenticated earlier: reuse gh's stored credential
    $token = ((& $ghExe auth token 2>&1 | Out-String).Trim())
}
if (-not $token) { Die 'no usable token (gh auth token returned nothing)' 2 }

$owner = ((& $ghExe api user --jq .login 2>&1 | Out-String).Trim())
if ($LASTEXITCODE -ne 0 -or -not $owner) { Die 'could not resolve GitHub user (check proxy / token scopes)' 2 }
Say ("account = " + $owner)

$remotes = ((& git -C $RepoPath remote 2>&1 | Out-String))
$hasOrigin = ($remotes -split "`r?`n" | Where-Object { $_.Trim() -eq 'origin' }).Count -gt 0

& $ghExe api ("repos/" + $owner + "/" + $RepoName) *> $null
$repoExists = ($LASTEXITCODE -eq 0)
Say ("repo exists = " + $repoExists)

if (-not $repoExists) {
    if (-not $CreateRepo) {
        Say 'repo does not exist and -CreateRepo was not passed: stopping before push.'
        Say ("create it manually then re-run, or pass -CreateRepo")
        exit 1
    }
    $visFlag = '--' + $Visibility
    Say ("creating " + $Visibility + " repo " + $owner + "/" + $RepoName)
    $cr = (& $ghExe repo create $RepoName $visFlag --source $RepoPath --remote origin 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { Die ("gh repo create failed: " + ($cr -replace '\s+', ' ')) 1 }
} elseif (-not $hasOrigin) {
    $url = "https://github.com/" + $owner + "/" + $RepoName + ".git"
    & git -C $RepoPath remote add origin $url | Out-Null
    Say ("origin added = " + $url)
}

# push with an ephemeral auth header: no credential is persisted in .git/config
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:" + $token))
$hdr = "AUTHORIZATION: basic " + $b64

Say 'pushing branch...'
& git -C $RepoPath -c http.extraheader=$hdr push -u origin HEAD 2>&1 | Out-String | ForEach-Object { Say ("  " + ($_ -replace '\s+', ' ').Trim()) }
if ($LASTEXITCODE -ne 0) { Die 'git push (branch) failed' 3 }

Say 'pushing tags...'
& git -C $RepoPath -c http.extraheader=$hdr push origin --tags 2>&1 | Out-String | ForEach-Object { Say ("  " + ($_ -replace '\s+', ' ').Trim()) }
if ($LASTEXITCODE -ne 0) { Say 'git push (tags) failed - branch is up, push tags manually' }

$final = "https://github.com/" + $owner + "/" + $RepoName
Say ("DONE: " + $final)
Say "=== gh-device-auth end ==="
exit 0
