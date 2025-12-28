#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [ValidateSet("init", "start-release", "finish-release")]
    [string]$Mode = "start-release",
    [string]$Version,
    [string]$SeedTag = "v1.9-stable",
    [string]$Origin = "origin",
    [switch]$CreateGitHubRelease,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$MainBranch = "main"
$DevelopBranch = "develop"
$NonWhitespaceControlCharsPattern = "[\x00-\x08\x0B-\x1F]"
$ValidModesDescription = "init, start-release, finish-release"

function Invoke-Git {
    param([string[]]$CommandArgs)
    $display = "git " + ($CommandArgs -join " ")
    if ($DryRun) {
        Write-Host "[dry-run] $display"
        return
    }

    & git @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $display"
    }
}

function Invoke-Cli {
    param(
        [string]$Executable,
        [string[]]$CommandArgs
    )
    $display = "$Executable " + ($CommandArgs -join " ")
    if ($DryRun) {
        Write-Host "[dry-run] $display"
        return
    }

    & $Executable @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $display"
    }
}

function Test-LocalBranch {
    param([string]$Branch)
    & git show-ref --verify --quiet "refs/heads/$Branch"
    return $LASTEXITCODE -eq 0
}

function Test-RemoteBranch {
    param([string]$Branch)
    & git ls-remote --exit-code --heads $Origin $Branch > $null 2>&1
    return $LASTEXITCODE -eq 0
}

function Assert-CleanWorkingTree {
    if ($DryRun) {
        return
    }

    $status = & git status --porcelain
    if ($LASTEXITCODE -ne 0) {
        throw "git status failed"
    }
    if ($status) {
        throw "Working tree is not clean. Commit or stash changes first."
    }
}

function Get-CurrentBranch {
    $name = & git rev-parse --abbrev-ref HEAD
    if ($LASTEXITCODE -ne 0) {
        throw "git rev-parse --abbrev-ref HEAD failed"
    }

    if ($name -eq "HEAD") {
        return $null
    }

    return $name.Trim()
}

function Ensure-Fetch {
    Invoke-Git @("fetch", "--all", "--prune")
}

function Ensure-Branch {
    param(
        [string]$Branch,
        [string]$FromRef
    )

    if (Test-LocalBranch $Branch) {
        Invoke-Git @("checkout", $Branch)
        return
    }

    if (Test-RemoteBranch $Branch) {
        Invoke-Git @("checkout", "-t", "$Origin/$Branch")
        return
    }

    Invoke-Git @("checkout", "-b", $Branch, $FromRef)
    Invoke-Git @("push", "-u", $Origin, $Branch)
}

function Ensure-ReleaseBranch {
    param(
        [string]$Branch,
        [string]$StartRef,
        [switch]$AllowCreate = $true
    )

    if (Test-LocalBranch $Branch) {
        Invoke-Git @("checkout", $Branch)
        return
    }

    if (Test-RemoteBranch $Branch) {
        Invoke-Git @("checkout", "-t", "$Origin/$Branch")
        return
    }

    if (-not $AllowCreate) {
        if ($DryRun) {
            Write-Host "Release branch '$Branch' does not exist locally or on $Origin; continuing because -DryRun is set."
            return
        }

        throw "Release branch '$Branch' does not exist locally or on $Origin."
    }

    $startIsBranch = Test-LocalBranch $StartRef
    if (-not $startIsBranch) {
        $startIsBranch = Test-RemoteBranch $StartRef
    }
    Invoke-Git @("checkout", $StartRef)

    $currentBranch = $null
    if (-not $DryRun) {
        $currentBranch = Get-CurrentBranch
    }

    if ($startIsBranch -and $currentBranch -eq $StartRef) {
        Invoke-Git @("pull", "--ff-only", $Origin, $StartRef)
    }

    Invoke-Git @("checkout", "-b", $Branch)
    Invoke-Git @("push", "-u", $Origin, $Branch)
}

function Get-PackageVersion {
    try {
        $pkg = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
        return $pkg.version
    } catch {
        throw "Unable to read version from package.json; pass -Version."
    }
}

function Get-ChangelogNotes {
    param([string]$Version)

    $file = Join-Path $repoRoot "CHANGELOG.md"
    if (-not (Test-Path $file)) {
        return ""
    }

    $lines = Get-Content $file
    $escaped = [regex]::Escape($Version)
    $start = $null

    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -match "^##\s+$escaped(\s|$)") {
            $start = $i + 1
            break
        }
    }

    if ($null -eq $start) {
        return ""
    }

    $buffer = @()
    for ($j = $start; $j -lt $lines.Length; $j++) {
        if ($lines[$j] -match "^##\s+") {
            break
        }

        $buffer += $lines[$j]
    }

    return ($buffer -join "`n").Trim()
}

if (-not $Version) {
    $Version = Get-PackageVersion
}

$tag = $Version
if ($Version -notmatch "^v") {
    $tag = "v$Version"
}
$releaseBranch = "release/$Version"

Write-Host "Repository: $repoRoot"
Write-Host "Mode: $Mode"
Write-Host "Version: $Version (tag $tag)"
Write-Host "Release branch: $releaseBranch"
Write-Host "Seed tag: $SeedTag"
Write-Host "Origin: $Origin"
if ($DryRun) {
    Write-Host "Dry run: commands will not execute"
}

switch ($Mode) {
    "init" {
        Ensure-Fetch
        Ensure-Branch -Branch $MainBranch -FromRef $SeedTag
        Ensure-Branch -Branch $DevelopBranch -FromRef $SeedTag
    }
    "start-release" {
        Assert-CleanWorkingTree
        Ensure-Fetch
        Ensure-Branch -Branch $MainBranch -FromRef $SeedTag
        Ensure-Branch -Branch $DevelopBranch -FromRef $SeedTag
        Ensure-ReleaseBranch -Branch $releaseBranch -StartRef $DevelopBranch
    }
    "finish-release" {
        Assert-CleanWorkingTree
        Ensure-Fetch
        Ensure-ReleaseBranch -Branch $releaseBranch -StartRef $DevelopBranch -AllowCreate:$false

        Invoke-Git @("checkout", $MainBranch)
        Invoke-Git @("pull", "--ff-only", $Origin, $MainBranch)
        Invoke-Git @("merge", "--no-ff", $releaseBranch, "-m", "chore(release): $Version")
        Invoke-Git @("tag", "-a", $tag, "-m", "Release $Version")
        Invoke-Git @("push", $Origin, $MainBranch)
        Invoke-Git @("push", $Origin, $tag)

        Invoke-Git @("checkout", $DevelopBranch)
        Invoke-Git @("pull", "--ff-only", $Origin, $DevelopBranch)
        Invoke-Git @("merge", "--no-ff", $releaseBranch, "-m", "chore(release): merge $Version back to develop")
        Invoke-Git @("push", $Origin, $DevelopBranch)

        Invoke-Git @("branch", "-d", $releaseBranch)
        Invoke-Git @("push", $Origin, "--delete", $releaseBranch)

        if ($CreateGitHubRelease) {
            if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
                Write-Warning "gh CLI not found; skipping GitHub release."
            } else {
                $notes = Get-ChangelogNotes -Version $Version
                if (-not $notes) {
                    $notes = "Release $Version"
                }

                $notes = [regex]::Replace($notes, $NonWhitespaceControlCharsPattern, " ").Trim()
                if (-not $notes) {
                    $notes = "Release $Version"
                }

                try {
                    Invoke-Cli -Executable "gh" -CommandArgs @(
                        "release", "create", $tag,
                        "--title", $tag,
                        "--notes", $notes
                    )
                } catch {
                    Write-Warning ("Failed to create GitHub release {0}: {1}" -f $tag, $_)
                }
            }
        }
    }
    default {
        throw "Unknown mode $Mode. Valid modes: $ValidModesDescription."
    }
}

Write-Host "Done."
