param([string]$Version = "1.1.4")

$extDir  = Split-Path $MyInvocation.MyCommand.Path
$buildDir = "$extDir\builds"

# ─── Files to copy (same for both targets) ───────────────────────────────────
$files = @("background.js","content.js","sidepanel.html","sidepanel.css","sidepanel.js","sidepanel-ui.js")

function Build-Zip {
    param([string]$tmpDir, [string]$manifestJson, [string]$dstZip)

    if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
    New-Item -ItemType Directory -Path $tmpDir | Out-Null
    New-Item -ItemType Directory -Path "$tmpDir\icons" | Out-Null
    New-Item -ItemType Directory -Path "$tmpDir\lib" | Out-Null

    [System.IO.File]::WriteAllText("$tmpDir\manifest.json", $manifestJson, [System.Text.Encoding]::UTF8)

    foreach ($f in $files) { Copy-Item "$extDir\$f" "$tmpDir\$f" -Force }
    Get-ChildItem "$extDir\icons" -File | ForEach-Object { Copy-Item $_.FullName "$tmpDir\icons\$($_.Name)" }
    Get-ChildItem "$extDir\lib"   -File | ForEach-Object { Copy-Item $_.FullName "$tmpDir\lib\$($_.Name)" }

    if (Test-Path $dstZip) { Remove-Item $dstZip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open($dstZip, 'Create')
    Get-ChildItem -Path $tmpDir -Recurse -File | ForEach-Object {
        $entry = $_.FullName.Substring($tmpDir.Length + 1).Replace('\','/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry, 'Optimal') | Out-Null
    }
    $zip.Dispose()
    Remove-Item $tmpDir -Recurse -Force

    $size = [math]::Round((Get-Item $dstZip).Length / 1KB, 1)
    Write-Host "  OK: $dstZip ($size KB)"
}

# ─── Chrome/Edge manifest (no browser_specific_settings) ─────────────────────
$chromeManifest = @"
{
  "manifest_version": 3,
  "name": "FYJOB Scanner",
  "version": "$Version",
  "description": "Quick job match analysis with synced FYJOB auth.",
  "permissions": ["activeTab","tabs","storage","scripting","sidePanel"],
  "host_permissions": ["http://*/*","https://*/*"],
  "action": {
    "default_title": "Open FYJOB Scanner",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "side_panel": { "default_path": "sidepanel.html" },
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [{
    "matches": ["http://*/*","https://*/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{ "resources": ["icons/*.png"], "matches": ["<all_urls>"] }],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
"@

# ─── Firefox manifest (gecko + sidebar_action) ────────────────────────────────
$firefoxManifest = @"
{
  "manifest_version": 3,
  "name": "FYJOB Scanner",
  "version": "$Version",
  "description": "Quick job match analysis with synced FYJOB auth.",
  "permissions": ["activeTab","tabs","storage","scripting"],
  "host_permissions": ["http://*/*","https://*/*"],
  "action": {
    "default_title": "Open FYJOB Scanner",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "sidebar_action": {
    "default_panel": "sidepanel.html",
    "default_title": "FYJOB Scanner",
    "default_icon": "icons/icon16.png"
  },
  "background": { "scripts": ["background.js"], "service_worker": "background.js", "type": "module" },
  "content_scripts": [{
    "matches": ["http://*/*","https://*/*"],
    "js": ["content.js"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{ "resources": ["icons/*.png"], "matches": ["<all_urls>"] }],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
  "browser_specific_settings": {
    "gecko": {
      "id": "fypodku@otaruram.dev",
      "strict_min_version": "140.0",
      "data_collection_permissions": {
        "required": ["websiteContent","browsingActivity","authenticationInfo"]
      }
    },
    "gecko_android": {
      "strict_min_version": "128.0",
      "data_collection_permissions": {
        "required": ["websiteContent","browsingActivity","authenticationInfo"]
      }
    }
  }
}
"@

Write-Host ""
Write-Host "Building v$Version..."

$chromeZip  = "$buildDir\fyjob-scanner-chrome-$Version.zip"
$firefoxXpi = "$buildDir\fyjob-scanner-firefox-$Version.xpi"

Build-Zip -tmpDir "$env:TEMP\fyjob-chrome-$Version"  -manifestJson $chromeManifest  -dstZip $chromeZip
Build-Zip -tmpDir "$env:TEMP\fyjob-firefox-$Version" -manifestJson $firefoxManifest -dstZip $firefoxXpi

Write-Host ""
Write-Host "Done! Artifacts:"
Get-ChildItem $buildDir | Sort-Object LastWriteTime | ForEach-Object { Write-Host "  $($_.Name)" }
