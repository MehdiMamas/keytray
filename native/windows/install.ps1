# Registers the Keytray native messaging host with Chrome and Edge on Windows.
#   powershell -ExecutionPolicy Bypass -File native\windows\install.ps1 [extra-extension-id ...]
#   powershell -ExecutionPolicy Bypass -File native\windows\install.ps1 -Uninstall
param(
  [switch]$Uninstall,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ExtraIds
)
$ErrorActionPreference = "Stop"

$StoreId = "kfkmcgkbicdmgdodjjindmnpofbcmoji"
$HostName = "com.keytray.agent"
$Dest = Join-Path $env:LOCALAPPDATA "Keytray"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Native = Split-Path -Parent $Here
$Config = Join-Path (Split-Path -Parent $Native) "wxt.config.ts"
$Utf8 = New-Object System.Text.UTF8Encoding $false
$Roots = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts"
)
$Manifest = Join-Path $Dest "$HostName.json"
$Files = @("keytray-agent.py", "keytray-agent-cli.py", "keytray-agent.cmd", "keytray.cmd", "$HostName.json")

if ($Uninstall) {
  foreach ($root in $Roots) {
    $key = Join-Path $root $HostName
    if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Force }
  }
  foreach ($file in $Files) {
    $path = Join-Path $Dest $file
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
  Write-Output "Keytray agent helper removed. agent.key is kept in $Dest."
  exit 0
}

# a real Python 3.8+; the WindowsApps python.exe is the Microsoft Store stub
$py = $null
foreach ($name in @("py", "python")) {
  foreach ($cmd in @(Get-Command $name -CommandType Application -All -ErrorAction SilentlyContinue)) {
    if ($cmd.Source -like "*\WindowsApps\*") { continue }
    $real = & $cmd.Source -c "import sys;print(sys.executable if sys.version_info >= (3, 8) else '')" 2>$null
    if ($LASTEXITCODE -eq 0 -and $real -and (Test-Path -LiteralPath $real)) { $py = $real; break }
  }
  if ($py) { break }
}
if (-not $py) {
  throw "Python 3.8 or newer was not found. Install it from https://www.python.org/downloads/ and run this script again."
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Force (Join-Path $Native "keytray-agent.py") (Join-Path $Dest "keytray-agent.py")
Copy-Item -Force (Join-Path $Native "keytray-agent-cli.py") (Join-Path $Dest "keytray-agent-cli.py")

function Write-Cmd([string]$ScriptName, [string]$CmdName) {
  $cmdPath = Join-Path $Dest $CmdName
  $scriptPath = Join-Path $Dest $ScriptName
  $lines = @("@echo off", "`"$py`" -u `"$scriptPath`" %*")
  [System.IO.File]::WriteAllText($cmdPath, ($lines -join "`r`n") + "`r`n", $Utf8)
  return $cmdPath
}
$hostCmd = Write-Cmd "keytray-agent.py" "keytray-agent.cmd"
$cliCmd = Write-Cmd "keytray-agent-cli.py" "keytray.cmd"

# Dev id: sha256 of the DER public key, first 32 hex chars mapped 0-f to a-p (same as install.sh)
$snippet = @'
import base64, hashlib, re, sys
text = open(sys.argv[1]).read()
key = re.search(r"EXTENSION_KEY\s*=\s*'([^']+)'", text).group(1)
digest = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in digest))
'@
$snipFile = Join-Path $Dest "devid.tmp.py"
[System.IO.File]::WriteAllText($snipFile, $snippet, $Utf8)
$devId = ((& $py $snipFile $Config) | Out-String).Trim()
Remove-Item -LiteralPath $snipFile -Force
if ($LASTEXITCODE -ne 0 -or -not $devId) { throw "Could not compute the dev extension id from wxt.config.ts." }

$ids = @()
foreach ($id in (@($StoreId, $devId) + @($ExtraIds))) {
  if ($id -and ($ids -notcontains $id)) { $ids += $id }
}
$origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
$body = [ordered]@{
  name = $HostName
  description = "Keytray agent sign-in bridge"
  path = $hostCmd
  type = "stdio"
  allowed_origins = $origins
} | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($Manifest, $body + "`n", $Utf8)

foreach ($root in $Roots) {
  $key = Join-Path $root $HostName
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value $Manifest
}

Write-Output "Store extension id: $StoreId"
Write-Output "Dev (key) extension id: $devId"
Write-Output "Host: $hostCmd"
Write-Output "CLI: $cliCmd"
Write-Output "Reload Keytray, then turn on Agent sign-in in Options."
