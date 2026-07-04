# Windows installer for template-cli

$binDir = Join-Path $Home ".local\bin"
if (!(Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force
}

$repoDir = (Get-Item $PSScriptRoot).Parent.FullName
$entryPoint = Join-Path $repoDir "dist\index.js"

Write-Host "Installing dependencies..."
bun install

Write-Host "Building template-cli..."
bun run build

Write-Host "Creating template-cli launcher..."
$launcherPath = Join-Path $binDir "template-cli.ps1"
@"
bun "$entryPoint" `$args
"@ | Out-File -FilePath $launcherPath -Encoding utf8

# Add binDir to path if not present
$path = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($path -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable("PATH", "$path;$binDir", "User")
    $env:PATH = "$env:PATH;$binDir"
    Write-Host "Added $binDir to user PATH. Please restart your terminal."
}

Write-Host "template-cli installed successfully!"
