# Builds the native Kotlin + Rust Trecker.apk.
# Requirements: JDK 17, Android SDK 34, NDK 27.2.12479018, Rust targets, cargo-ndk,
# Node.js and Gradle 8.9 in ~/trecker-tools (or set TRECKER_TOOLS / GRADLE_HOME).
$ErrorActionPreference = "Stop"
$App   = $PSScriptRoot
$Tools = if ($env:TRECKER_TOOLS) { $env:TRECKER_TOOLS } else { Join-Path $env:USERPROFILE 'trecker-tools' }
$BT    = "$Tools\sdk\build-tools\34.0.0"
$Out   = "$App\build\native-release"
$Apk   = "$App\..\Trecker.apk"
$Gradle = if ($env:GRADLE_HOME) { "$env:GRADLE_HOME\bin\gradle.bat" } else { "$Tools\gradle-8.9\bin\gradle.bat" }
$env:JAVA_HOME = "$Tools\jdk"
$env:ANDROID_HOME = "$Tools\sdk"
$env:ANDROID_NDK_HOME = "$Tools\sdk\ndk\27.2.12479018"
$env:Path = "$Tools\jdk\bin;$Tools\node;$env:USERPROFILE\.cargo\bin;$env:Path"

function Run($exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$exe failed ($LASTEXITCODE)" }
}

Write-Host "1/5 bundled data"
Run "node" @("$App\tools\prepare-native.cjs")

Write-Host "2/5 Rust JNI"
Push-Location "$App\rust"
try { Run "cargo" @("ndk", "-t", "arm64-v8a", "-t", "armeabi-v7a", "-t", "x86_64", "-o", "../native/app/src/main/jniLibs", "build", "--locked", "--release") }
finally { Pop-Location }

Write-Host "3/5 Kotlin + MapLibre"
Push-Location "$App\native"
try { Run $Gradle @(":app:assembleRelease") } finally { Pop-Location }

Write-Host "4/5 align"
New-Item -ItemType Directory -Force $Out | Out-Null
$Unsigned = "$App\native\app\build\outputs\apk\release\app-release-unsigned.apk"
if (-not (Test-Path $Unsigned)) { $Unsigned = "$App\native\app\build\outputs\apk\release\app-release.apk" }
Run "$BT\zipalign.exe" @("-f", "-p", "4", $Unsigned, "$Out\aligned.apk")

Write-Host "5/5 sign + verify"
$Ks = if ($env:TRECKER_KEYSTORE) { $env:TRECKER_KEYSTORE } else { "$App\android\trecker.keystore" }
if (-not (Test-Path $Ks)) {
    throw "Release keystore missing. Set TRECKER_KEYSTORE to the existing signing key."
}
$Signed = "$Out\Trecker.apk"
Run "$BT\apksigner.bat" @("sign", "--ks", $Ks, "--ks-pass", "pass:trecker", "--key-pass", "pass:trecker",
                          "--out", $Signed, "$Out\aligned.apk")
$certs = Run "$BT\apksigner.bat" @("verify", "--print-certs", $Signed)
$releaseDigest = "92e1bf8bb8832a41fd0e419209b4ec7c7ce4a78f68a3cafccce7a22b6904db1b"
if (-not ($certs -contains "Signer #1 certificate SHA-256 digest: $releaseDigest")) {
    throw "Signing certificate differs from v1.12. Set TRECKER_KEYSTORE to the release key."
}
Copy-Item -LiteralPath $Signed -Destination $Apk -Force
Copy-Item -LiteralPath "$Signed.idsig" -Destination "$Apk.idsig" -Force
$size = [math]::Round((Get-Item $Apk).Length / 1MB, 2)
Write-Host "OK: $((Resolve-Path $Apk).Path)  ($size MB)"
