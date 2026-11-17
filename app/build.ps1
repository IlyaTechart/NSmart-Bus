# Builds Trecker.apk (no Android Studio / Gradle needed).
# Tools: JDK 17 + Android SDK (platforms;android-34, build-tools;34.0.0) in ~/trecker-tools
# (or set $env:TRECKER_TOOLS). Run:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
$App   = $PSScriptRoot
$Tools = if ($env:TRECKER_TOOLS) { $env:TRECKER_TOOLS } else { Join-Path $env:USERPROFILE 'trecker-tools' }
$BT    = "$Tools\sdk\build-tools\34.0.0"
$AJ    = "$Tools\sdk\platforms\android-34\android.jar"
$env:JAVA_HOME = "$Tools\jdk"
$env:Path = "$Tools\jdk\bin;$env:Path"
$Out   = "$App\build"
$Apk   = "$App\..\Trecker.apk"

function Run($exe, [string[]]$argv) {
    & $exe @argv
    if ($LASTEXITCODE -ne 0) { throw "$exe failed ($LASTEXITCODE)" }
}

$ResolvedApp = [IO.Path]::GetFullPath($App)
$ResolvedOut = [IO.Path]::GetFullPath($Out)
if ($ResolvedOut -ne (Join-Path $ResolvedApp 'build')) { throw 'Unexpected build directory' }
if (Test-Path -LiteralPath $ResolvedOut) { Remove-Item -LiteralPath $ResolvedOut -Recurse -Force }
New-Item -ItemType Directory -Force "$Out\classes", "$Out\dex", "$Out\assets", "$Out\gen" | Out-Null

Write-Host "1/6 resources"
Run "$BT\aapt2.exe" @("compile", "--dir", "$App\android\res", "-o", "$Out\res.zip")

Write-Host "2/6 web app -> assets"
Copy-Item -Recurse "$App\www" "$Out\assets\www"

Write-Host "3/6 manifest + resources + assets"
Run "$BT\aapt2.exe" @("link", "-o", "$Out\base.apk", "-I", $AJ, "--manifest", "$App\android\AndroidManifest.xml",
                      "--java", "$Out\gen", "$Out\res.zip")

Run "jar" @("uf", "$Out\base.apk", "-C", $Out, "assets")

Write-Host "4/6 java"
$src = Get-ChildItem -Recurse "$App\android\src" -Filter *.java | ForEach-Object { $_.FullName }
Run "javac" (@("-encoding", "UTF-8", "-source", "8", "-target", "8", "-nowarn", "-Xlint:-options",
               "-bootclasspath", $AJ, "-classpath", "$BT\core-lambda-stubs.jar", "-d", "$Out\classes") + $src)

Write-Host "5/6 dex"
$classes = Get-ChildItem -Recurse "$Out\classes" -Filter *.class | ForEach-Object { $_.FullName }
Run "$BT\d8.bat" (@("--release", "--lib", $AJ, "--min-api", "24", "--output", "$Out\dex") + $classes)
Copy-Item "$Out\base.apk" "$Out\unsigned.apk"
Push-Location "$Out\dex"
try { Run "$BT\aapt.exe" @("add", "$Out\unsigned.apk", "classes.dex") | Out-Null } finally { Pop-Location }

Write-Host "6/6 align + sign"
Run "$BT\zipalign.exe" @("-f", "-p", "4", "$Out\unsigned.apk", "$Out\aligned.apk")
$Ks = if ($env:TRECKER_KEYSTORE) { $env:TRECKER_KEYSTORE } else { "$App\android\trecker.keystore" }
if (-not (Test-Path $Ks)) {
    Run "keytool" @("-genkeypair", "-keystore", $Ks, "-alias", "trecker", "-keyalg", "RSA", "-keysize", "2048",
                    "-validity", "10000", "-storepass", "trecker", "-keypass", "trecker", "-dname", "CN=Trecker NS")
}
Run "$BT\apksigner.bat" @("sign", "--ks", $Ks, "--ks-pass", "pass:trecker", "--key-pass", "pass:trecker",
                          "--out", $Apk, "$Out\aligned.apk")
Run "$BT\apksigner.bat" @("verify", $Apk)
$size = [math]::Round((Get-Item $Apk).Length / 1MB, 2)
Write-Host "OK: $((Resolve-Path $Apk).Path)  ($size MB)"
