$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'This setup script downloads Windows x64 tools only.'
}
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root '.tools'
$downloads = Join-Path $tools 'downloads'
New-Item -ItemType Directory -Force -Path $downloads | Out-Null

function Get-VerifiedArchive([string]$Url, [string]$Name, [string]$Sha256) {
    $path = Join-Path $downloads $Name
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Host "Downloading $Name from $([uri]$Url | Select-Object -ExpandProperty Host)..."
        Invoke-WebRequest -Uri $Url -OutFile $path
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $Sha256) {
        throw "Checksum mismatch: $path. Do not extract or execute this archive."
    }
    Write-Host "Verified SHA-256: $Name"
    return $path
}

$javaHome = Join-Path $tools 'jdk'
if (-not (Test-Path -LiteralPath (Join-Path $javaHome 'bin\java.exe'))) {
    $archive = Get-VerifiedArchive 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip' 'temurin21-windows-x64.zip' 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e'
    $staging = Join-Path $tools 'jdk-extracted'
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    $javaDirectory = Get-ChildItem -LiteralPath $staging -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\java.exe') } | Select-Object -First 1
    if (-not $javaDirectory) { throw 'The verified archive did not contain the expected Java distribution.' }
    Move-Item -LiteralPath $javaDirectory.FullName -Destination $javaHome
}

$sdkHome = Join-Path $tools 'android-sdk'
$sdkManager = Join-Path $sdkHome 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path -LiteralPath $sdkManager)) {
    $archive = Get-VerifiedArchive 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' 'android-commandlinetools-windows.zip' '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
    $staging = Join-Path $tools 'android-tools-extracted'
    Expand-Archive -LiteralPath $archive -DestinationPath $staging
    New-Item -ItemType Directory -Force -Path (Join-Path $sdkHome 'cmdline-tools') | Out-Null
    Move-Item -LiteralPath (Join-Path $staging 'cmdline-tools') -Destination (Join-Path $sdkHome 'cmdline-tools\latest')
}

$previousJava = $env:JAVA_HOME
$previousPath = $env:Path
try {
    $env:JAVA_HOME = $javaHome
    $env:Path = "$(Join-Path $javaHome 'bin');$env:Path"
    & (Join-Path $javaHome 'bin\java.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Downloaded Java did not start.' }
    Write-Host 'The Android SDK manager may ask you to review and accept its license. No license is accepted automatically.'
    & $sdkManager "--sdk_root=$sdkHome" 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
    if ($LASTEXITCODE -ne 0) { throw 'SDK installation did not complete.' }
    & (Join-Path $PSScriptRoot 'android.ps1') -Check
}
finally {
    $env:JAVA_HOME = $previousJava
    $env:Path = $previousPath
}