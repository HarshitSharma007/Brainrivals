param([switch]$Check)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$javaHomes = @(
    $env:JAVA_HOME,
    (Join-Path $root '.tools\jdk'),
    'C:\Program Files\Android\Android Studio\jbr'
)
$javaHome = $javaHomes | Where-Object {
    $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin\java.exe'))
} | Select-Object -First 1
if (-not $javaHome) {
    $javaCommand = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($javaCommand) { $javaHome = Split-Path -Parent (Split-Path -Parent $javaCommand.Source) }
}
$sdkHomes = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    (Join-Path $root '.tools\android-sdk'),
    (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
)
$sdkHome = $sdkHomes | Where-Object {
    $_ -and (Test-Path -LiteralPath (Join-Path $_ 'platforms\android-35\android.jar')) -and
    (Test-Path -LiteralPath (Join-Path $_ 'build-tools\35.0.0\aapt2.exe'))
} | Select-Object -First 1
$missing = @()
if (-not $javaHome) { $missing += 'Java 21 (JAVA_HOME or .tools\jdk)' }
if (-not $sdkHome) { $missing += 'Android SDK platform 35 and build-tools 35.0.0 (ANDROID_HOME or .tools\android-sdk)' }
if ($missing.Count) { throw "Missing Android prerequisites: $($missing -join '; '). See README.md, Android packaging." }

$previous = @{}
foreach ($name in @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'GRADLE_USER_HOME', 'Path')) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
Push-Location $root
try {
    $env:JAVA_HOME = $javaHome
    $env:ANDROID_HOME = $sdkHome
    $env:ANDROID_SDK_ROOT = $sdkHome
    $env:GRADLE_USER_HOME = Join-Path $root '.tools\gradle'
    $env:Path = "$(Join-Path $javaHome 'bin');$(Join-Path $sdkHome 'platform-tools');$env:Path"
    & (Join-Path $javaHome 'bin\java.exe') --version
    if ($LASTEXITCODE -ne 0) { throw 'Java could not run.' }
    Write-Host "Android SDK: $sdkHome"
    if ($Check) {
        Write-Host 'Required Java executable and Android SDK packages are available.'
        return
    }
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Web build or Capacitor sync failed.' }
    & (Join-Path $root 'android\gradlew.bat') -p android --no-daemon --console=plain assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android debug compilation failed.' }
    $apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw 'Gradle completed without producing the expected debug APK.' }
    Get-Item -LiteralPath $apk | Select-Object FullName, Length, LastWriteTime
    Write-Host 'Debug APK only. Physical-device testing and signed release publication are separate steps.'
}
finally {
    Pop-Location
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}