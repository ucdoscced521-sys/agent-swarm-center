# push-to-github.ps1 - one-shot push of this repo to a PRIVATE GitHub repo.
#
# Why this script exists:
#   Creating a GitHub repo and pushing require YOUR authorization (browser OAuth or
#   a personal access token). That step cannot be automated on your behalf.
#   This script does everything else and tells you exactly what is left.
#
# Usage:
#   .\scripts\push-to-github.ps1 -RepoName agent-swarm-center
#   .\scripts\push-to-github.ps1 -RepoName agent-swarm-center -GitHubUser yourname
#   .\scripts\push-to-github.ps1 -RepoName agent-swarm-center -RemoteUrl https://github.com/you/repo.git
#
# ASCII-only on purpose: PowerShell 5.1 mis-decodes non-ASCII .ps1 without a BOM.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $RepoName,
    [string] $GitHubUser,
    [string] $RemoteUrl,
    [ValidateSet('private', 'public')] [string] $Visibility = 'private'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

function Say($msg) { Write-Host $msg }
function Ok($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red }

Say "=== push-to-github ==="
Say "repo root : $repoRoot"
Say "repo name : $RepoName"
Say "visibility: $Visibility"
Say ""

# --- 1. must be a git repo with at least one commit
if (-not (Test-Path (Join-Path $repoRoot '.git'))) {
    Fail "not a git repository. Run 'git init' and commit first."
    exit 1
}
$headExists = $true
git rev-parse --verify HEAD 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { $headExists = $false }
if (-not $headExists) {
    Fail "no commit yet. Commit your work first."
    exit 1
}
Ok ("current branch: " + (git rev-parse --abbrev-ref HEAD))
Ok ("HEAD: " + (git rev-parse --short HEAD))

# --- 2. working tree must be clean
$dirty = git status --porcelain
if ($dirty) {
    Warn "working tree has uncommitted changes:"
    $dirty | ForEach-Object { Write-Host "       $_" }
    Warn "push will still work, but you may want to commit these first."
}

# --- 3. already has a remote?
$existing = git remote
if ($existing -contains 'origin') {
    Ok "remote 'origin' already set:"
    git remote -v | ForEach-Object { Write-Host "       $_" }
} else {
    Warn "no 'origin' remote yet - will be added below."
}

# --- 4. locate gh: PATH first, then the portable install used on this machine
$ghCmd = Get-Command gh -ErrorAction SilentlyContinue
if (-not $ghCmd) {
    $portable = Join-Path $env:LOCALAPPDATA 'gh-portable\bin\gh.exe'
    if (Test-Path $portable) {
        $ghCmd = Get-Item $portable
        Ok ("found portable gh: " + $portable)
    }
}
if ($ghCmd) {
    # CommandInfo has .Source; FileInfo has .FullName. Normalize both.
    $ghExe = if ($ghCmd.PSObject.Properties.Name -contains 'Source' -and $ghCmd.Source) { $ghCmd.Source } else { $ghCmd.FullName }
    if (-not $ghExe) { Fail "could not resolve gh executable path"; exit 1 }
    Ok ("using gh: " + $ghExe)
    $authOk = $true
    & $ghExe auth status *> $null
    if ($LASTEXITCODE -ne 0) { $authOk = $false }
    if (-not $authOk) {
        Warn "gh is installed but NOT authenticated."
        Say  ""
        Say  "Run this once, complete the browser login, then re-run this script:"
        Say  "    & `"$ghExe`" auth login"
        Say  ""
        Say  "Or, if you already have a Personal Access Token:"
        Say  "    `$env:GH_TOKEN = 'ghp_xxx'"
        Say  "    .\scripts\push-to-github.ps1 -RepoName $RepoName"
        exit 2
    }
    Ok "gh is authenticated"
    $visFlag = "--$Visibility"
    if ($existing -notcontains 'origin') {
        Say "creating repo '$RepoName' ($Visibility) and pushing..."
        & $ghExe repo create $RepoName --source . $visFlag --push
        if ($LASTEXITCODE -ne 0) { Fail "gh repo create failed (exit $LASTEXITCODE)"; exit 1 }
        git push origin --tags
        Ok "done. tags pushed."
        exit 0
    } else {
        Say "origin exists; pushing current branch and tags..."
        git push -u origin HEAD
        git push origin --tags
        Ok "done."
        exit 0
    }
}

# --- 5. no gh: give exact manual steps
Warn "gh CLI not found. Two options:"
Say  ""
Say  "OPTION A - install gh (recommended, then this script finishes the job):"
Say  "    winget install --id GitHub.cli -e"
Say  "    gh auth login"
Say  "    .\scripts\push-to-github.ps1 -RepoName $RepoName"
Say  ""
Say  "OPTION B - do it manually (one browser step, then push):"
Say  "    1) Open https://github.com/new"
Say  "    2) Repository name : $RepoName"
if ($GitHubUser) { Say "       Owner            : $GitHubUser" }
Say  "       Visibility       : PRIVATE  (do NOT add README/.gitignore/license)"
Say  "    3) Click 'Create repository', then run:"
$userPart = if ($GitHubUser) { $GitHubUser } else { '<your-user>' }
Say  "       git remote add origin https://github.com/$userPart/$RepoName.git"
Say  "       git push -u origin HEAD"
Say  "       git push origin --tags"
Say  ""
if ($RemoteUrl) {
    Say  "Or, using the URL you passed in:"
    Say  "       git remote add origin $RemoteUrl"
    Say  "       git push -u origin HEAD"
    Say  "       git push origin --tags"
    Say  ""
}
Say  "NOTE: the first push will pop up Git Credential Manager once."
Say  "      That browser/token step must be completed by you - it cannot be automated."
exit 2
