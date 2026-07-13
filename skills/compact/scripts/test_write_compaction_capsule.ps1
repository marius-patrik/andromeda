$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptUnderTest = Join-Path $PSScriptRoot "write_compaction_capsule.ps1"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("rommie-compact-test-" + [guid]::NewGuid().ToString("N"))

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function New-FakeAgents {
    param([string]$Root)
    $path = Join-Path $Root "fake-agents.ps1"
    @'
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$CommandArgs)
$ErrorActionPreference = "Stop"
Add-Content -LiteralPath $env:FAKE_AGENTS_LOG -Value ($CommandArgs -join " ")

if ($CommandArgs[0] -eq "state" -and $CommandArgs[1] -eq "env") {
    "AGENTS_HOME=$env:FAKE_AGENTS_HOME"
    "AGENTS_MEMORY=$env:FAKE_AGENTS_MEMORY"
    exit 0
}
if ($CommandArgs[0] -eq "memory" -and $CommandArgs[1] -eq "list") {
    if ($env:FAKE_ACTIVE_ID) {
        @(@{ id = $env:FAKE_ACTIVE_ID; status = "active" }) | ConvertTo-Json -Compress
    } else {
        "[]"
    }
    exit 0
}
if ($CommandArgs[0] -eq "memory" -and $CommandArgs[1] -eq "remember") {
    @{ id = "record-new"; status = "active" } | ConvertTo-Json -Compress
    exit 0
}
if ($CommandArgs[0] -eq "memory" -and $CommandArgs[1] -eq "supersede") {
    @{ id = "record-superseded"; status = "active" } | ConvertTo-Json -Compress
    exit 0
}
if ($CommandArgs[0] -eq "memory" -and $CommandArgs[1] -eq "render") {
    @{ filePath = (Join-Path $env:FAKE_AGENTS_MEMORY "views/startup.md"); changed = $true } | ConvertTo-Json -Compress
    exit 0
}
if ($CommandArgs[0] -eq "memory" -and $CommandArgs[1] -eq "status") {
    @{ ok = $true; projectionHash = "projection-hash" } | ConvertTo-Json -Compress
    exit 0
}
if ($CommandArgs[0] -eq "state" -and $CommandArgs[1] -eq "sync") {
    @{ pushed = $true; restored = @{ imported = 0 } } | ConvertTo-Json -Compress
    exit 0
}
throw "Unexpected fake agents command: $($CommandArgs -join ' ')"
'@ | Set-Content -LiteralPath $path -Encoding UTF8
    return $path
}

function Initialize-Case {
    param([string]$Name)
    $root = Join-Path $testRoot $Name
    $agentsHome = Join-Path $root ".agents"
    $memoryRoot = Join-Path $agentsHome "memory"
    $compatibilityRoot = Join-Path $root ".codex/memories"
    New-Item -ItemType Directory -Path $memoryRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $compatibilityRoot -Force | Out-Null
    $log = Join-Path $root "agents.log"
    New-Item -ItemType File -Path $log -Force | Out-Null
    $fake = New-FakeAgents -Root $root
    return [ordered]@{
        Root = $root
        AgentsHome = $agentsHome
        MemoryRoot = $memoryRoot
        CompatibilityRoot = $compatibilityRoot
        Log = $log
        Fake = $fake
    }
}

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null

    # Primary path: first capsule becomes canonical, renders, syncs, and projects.
    $primary = Initialize-Case -Name "primary"
    $env:FAKE_AGENTS_HOME = $primary.AgentsHome
    $env:FAKE_AGENTS_MEMORY = $primary.MemoryRoot
    $env:FAKE_AGENTS_LOG = $primary.Log
    $env:FAKE_ACTIVE_ID = ""
    $result = & $scriptUnderTest -Objective "resume board" -State "ready" -Next "start planned 1" -Validation "green" -Blockers "None" -Repos "repo@abc" -AgentsCommand $primary.Fake -CompatibilityRoot $primary.CompatibilityRoot | ConvertFrom-Json
    Assert-True ($result.ok -eq $true) "primary: expected ok result"
    Assert-True ($result.recordId -eq "record-new") "primary: expected remembered record"
    Assert-True ($result.repositorySynced -eq $true) "primary: expected repository sync"
    Assert-True (Test-Path -LiteralPath $result.snapshot) "primary: expected immutable snapshot"
    Assert-True ((Get-Content -Raw (Join-Path $primary.CompatibilityRoot "handoff.md")) -match "Authority:.*memory") "primary: expected authority-marked projection"
    $primaryLog = Get-Content -Raw $primary.Log
    Assert-True ($primaryLog -match "memory remember") "primary: remember was not called"
    Assert-True ($primaryLog -match "state sync --json") "primary: state sync was not called"

    # Edge path: an existing active capsule is explicitly superseded.
    $edge = Initialize-Case -Name "edge"
    $env:FAKE_AGENTS_HOME = $edge.AgentsHome
    $env:FAKE_AGENTS_MEMORY = $edge.MemoryRoot
    $env:FAKE_AGENTS_LOG = $edge.Log
    $env:FAKE_ACTIVE_ID = "prior-record"
    $edgeResult = & $scriptUnderTest -Objective "new objective" -State "active" -Next "continue" -AgentsCommand $edge.Fake -CompatibilityRoot $edge.CompatibilityRoot -SkipRepositorySync | ConvertFrom-Json
    Assert-True ($edgeResult.recordId -eq "record-superseded") "edge: expected superseding record"
    Assert-True ((Get-Content -Raw $edge.Log) -match "memory supersede prior-record") "edge: prior record was not superseded"

    # Denied path: memory outside AGENTS_HOME is rejected before a snapshot write.
    $denied = Initialize-Case -Name "denied"
    $outsideMemory = Join-Path $denied.Root "outside-memory"
    New-Item -ItemType Directory -Path $outsideMemory -Force | Out-Null
    $env:FAKE_AGENTS_HOME = $denied.AgentsHome
    $env:FAKE_AGENTS_MEMORY = $outsideMemory
    $env:FAKE_AGENTS_LOG = $denied.Log
    $env:FAKE_ACTIVE_ID = ""
    $deniedMessage = ""
    try {
        & $scriptUnderTest -Objective "must fail" -State "invalid" -Next "none" -AgentsCommand $denied.Fake -CompatibilityRoot $denied.CompatibilityRoot -SkipRepositorySync | Out-Null
    } catch {
        $deniedMessage = $_.Exception.Message
    }
    Assert-True ($deniedMessage -match "must remain under AGENTS_HOME") "denied: outside authority was not rejected"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $outsideMemory "snapshots/compaction"))) "denied: wrote outside canonical authority"

    Write-Output "compact capsule regression triplet passed"
} finally {
    Remove-Item Env:FAKE_AGENTS_HOME -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_AGENTS_MEMORY -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_AGENTS_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:FAKE_ACTIVE_ID -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}


