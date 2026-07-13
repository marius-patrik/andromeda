param(
    [Parameter(Mandatory=$true)][string]$Objective,
    [Parameter(Mandatory=$true)][string]$State,
    [Parameter(Mandatory=$true)][string]$Next,
    [string]$Validation = "Not recorded.",
    [string]$Blockers = "None.",
    [string]$Repos = "Not recorded.",
    [string]$AgentsCommand = "agents",
    [string]$CompatibilityRoot = (Join-Path $env:USERPROFILE ".codex\memories"),
    [switch]$SkipCompatibilityProjection,
    [switch]$SkipRepositorySync,
    [switch]$ClearCache
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-AgentsJson {
    param([Parameter(Mandatory=$true)][string[]]$Arguments)

    $global:LASTEXITCODE = 0
    $output = & $AgentsCommand @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "agents command failed ($LASTEXITCODE): agents $($Arguments -join ' ')"
    }
    $text = ($output | Out-String).Trim()
    if (-not $text) {
        throw "agents command returned no JSON: agents $($Arguments -join ' ')"
    }
    try {
        return $text | ConvertFrom-Json
    } catch {
        throw "agents command returned invalid JSON: agents $($Arguments -join ' ')"
    }
}

function Resolve-AgentEnvironment {
    $global:LASTEXITCODE = 0
    $lines = & $AgentsCommand state env
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to resolve canonical Agent OS environment."
    }

    $values = @{}
    foreach ($line in $lines) {
        $text = [string]$line
        $separator = $text.IndexOf("=")
        if ($separator -le 0) { continue }
        $values[$text.Substring(0, $separator)] = $text.Substring($separator + 1)
    }

    if (-not $values.AGENTS_HOME) {
        throw "agents state env did not provide AGENTS_HOME."
    }
    $agentsHome = [System.IO.Path]::GetFullPath($values.AGENTS_HOME)
    $memoryRoot = if ($values.AGENTS_MEMORY) {
        [System.IO.Path]::GetFullPath($values.AGENTS_MEMORY)
    } else {
        [System.IO.Path]::GetFullPath((Join-Path $agentsHome "memory"))
    }

    $relative = [System.IO.Path]::GetRelativePath($agentsHome, $memoryRoot)
    if (
        [System.IO.Path]::IsPathRooted($relative) -or
        $relative -eq ".." -or
        $relative.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)") -or
        $relative.StartsWith("..$([System.IO.Path]::AltDirectorySeparatorChar)")
    ) {
        throw "Canonical memory root must remain under AGENTS_HOME: $memoryRoot"
    }
    if (-not (Test-Path -LiteralPath $agentsHome -PathType Container)) {
        throw "AGENTS_HOME does not exist: $agentsHome"
    }
    if (-not (Test-Path -LiteralPath $memoryRoot -PathType Container)) {
        throw "Canonical memory root does not exist: $memoryRoot"
    }

    return [ordered]@{ AgentsHome = $agentsHome; MemoryRoot = $memoryRoot }
}

function Write-Utf8NoBom {
    param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)][string]$Content)
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Update-ProjectionBlock {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Start,
        [Parameter(Mandatory=$true)][string]$End,
        [Parameter(Mandatory=$true)][string]$Section
    )

    $existing = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw } else { "" }
    $pattern = "(?s)" + [regex]::Escape($Start) + ".*?" + [regex]::Escape($End)
    $updated = if ($existing -match $pattern) {
        [regex]::Replace($existing, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $Section })
    } elseif ($existing.Trim()) {
        $existing.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine + $Section + [Environment]::NewLine
    } else {
        $Section + [Environment]::NewLine
    }
    Write-Utf8NoBom -Path $Path -Content $updated
}

$authority = Resolve-AgentEnvironment
$now = Get-Date -Format o
$capsuleId = "{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), ([guid]::NewGuid().ToString("N"))
$snapshotDirectory = Join-Path $authority.MemoryRoot "snapshots\compaction"
New-Item -ItemType Directory -Path $snapshotDirectory -Force | Out-Null
$snapshotPath = Join-Path $snapshotDirectory "$capsuleId.json"

$payload = [ordered]@{
    schemaVersion = 2
    capsuleId = $capsuleId
    createdAt = $now
    objective = $Objective
    state = $State
    next = $Next
    validation = $Validation
    blockers = $Blockers
    repos = $Repos
    authority = [ordered]@{
        agentsHome = $authority.AgentsHome
        memoryRoot = $authority.MemoryRoot
        record = "session:compaction.current"
    }
}
$snapshotJson = $payload | ConvertTo-Json -Depth 5
Write-Utf8NoBom -Path $snapshotPath -Content ($snapshotJson + [Environment]::NewLine)
$snapshotHash = (Get-FileHash -LiteralPath $snapshotPath -Algorithm SHA256).Hash.ToLowerInvariant()
$snapshotUri = ([System.Uri]::new($snapshotPath)).AbsoluteUri
$memoryValue = ($payload | ConvertTo-Json -Depth 5 -Compress)

$activeResult = Invoke-AgentsJson -Arguments @(
    "memory", "list",
    "--scope", "session",
    "--subject", "compaction",
    "--predicate", "current",
    "--status", "active",
    "--json"
)
$active = @($activeResult)
if ($active.Count -gt 1) {
    throw "Canonical memory contains multiple active compaction records; refusing to guess."
}

$evidenceArgs = @(
    "--value", $memoryValue,
    "--source", $snapshotUri,
    "--hash", $snapshotHash,
    "--source-class", "verified",
    "--confidence", "1",
    "--sensitivity", "internal",
    "--observed-at", $now,
    "--json"
)
$record = if ($active.Count -eq 1) {
    Invoke-AgentsJson -Arguments (@("memory", "supersede", [string]$active[0].id) + $evidenceArgs)
} else {
    Invoke-AgentsJson -Arguments (@(
        "memory", "remember",
        "--scope", "session",
        "--subject", "compaction",
        "--predicate", "current"
    ) + $evidenceArgs)
}

$render = Invoke-AgentsJson -Arguments @("memory", "render", "--json")
$memoryStatus = Invoke-AgentsJson -Arguments @("memory", "status", "--json")
if (-not $memoryStatus.ok) {
    throw "Canonical memory integrity failed after writing the compaction capsule."
}

$sync = $null
if (-not $SkipRepositorySync) {
    $sync = Invoke-AgentsJson -Arguments @("state", "sync", "--json")
}

$statePath = Join-Path $authority.MemoryRoot ".compact-state.json"
$statePayload = [ordered]@{
    schemaVersion = 2
    lastCompact = $now
    authority = "agents-memory-events"
    recordId = $record.id
    snapshot = $snapshotPath
    snapshotSha256 = $snapshotHash
    projection = $render.filePath
    projectionHash = $memoryStatus.projectionHash
    repositorySync = $sync
}
Write-Utf8NoBom -Path $statePath -Content (($statePayload | ConvertTo-Json -Depth 8) + [Environment]::NewLine)

if (-not $SkipCompatibilityProjection) {
    $compatibilityRootPath = [System.IO.Path]::GetFullPath($CompatibilityRoot)
    $canonicalRootPath = [System.IO.Path]::GetFullPath($authority.MemoryRoot)
    if ($compatibilityRootPath -eq $canonicalRootPath) {
        throw "Compatibility projection root must not equal canonical memory root."
    }
    New-Item -ItemType Directory -Path $compatibilityRootPath -Force | Out-Null

    $handoffSection = @"
<!-- rommie:compact:start -->
## Rommie Compaction Projection
Generated: $now
Authority: `$($authority.MemoryRoot)` immutable memory events
Record: `$($record.id)`
Snapshot: `$snapshotPath`

Objective:
- $Objective

State:
- $State

Next:
- $Next

Validation:
- $Validation

Blockers:
- $Blockers

Repos:
- $Repos
<!-- rommie:compact:end -->
"@
    Update-ProjectionBlock -Path (Join-Path $compatibilityRootPath "handoff.md") -Start "<!-- rommie:compact:start -->" -End "<!-- rommie:compact:end -->" -Section $handoffSection

    $shortSection = @"
<!-- rommie:compact-short:start -->
## Rommie Compaction Active-Work Projection
Generated: $now
Authority record: `$($record.id)`
Current objective: $Objective
Status: $State
Next actions: $Next
Blockers: $Blockers
Last validation: $Validation
<!-- rommie:compact-short:end -->
"@
    Update-ProjectionBlock -Path (Join-Path $compatibilityRootPath "SHORT.md") -Start "<!-- rommie:compact-short:start -->" -End "<!-- rommie:compact-short:end -->" -Section $shortSection

    $compatibilityState = [ordered]@{
        schemaVersion = 2
        generatedProjection = $true
        canonicalMemoryRoot = $authority.MemoryRoot
        recordId = $record.id
        snapshot = $snapshotPath
    }
    Write-Utf8NoBom -Path (Join-Path $compatibilityRootPath ".compact-state.json") -Content (($compatibilityState | ConvertTo-Json -Depth 4) + [Environment]::NewLine)

    if ($ClearCache) {
        Write-Utf8NoBom -Path (Join-Path $compatibilityRootPath "cache.md") -Content ("# Immediate Task Cache`n`nGenerated compatibility cache. Canonical authority is under `$($authority.MemoryRoot)`.`n`nCurrent cache:`n- None.`n")
    }
}

[ordered]@{
    ok = $true
    authority = $authority.MemoryRoot
    recordId = $record.id
    snapshot = $snapshotPath
    projection = $render.filePath
    projectionHash = $memoryStatus.projectionHash
    repositorySynced = -not $SkipRepositorySync
} | ConvertTo-Json -Depth 4


