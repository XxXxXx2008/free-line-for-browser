$ErrorActionPreference = "Stop"

$workspaceDirectory = Split-Path -Parent $PSScriptRoot
$extensionDirectory = Join-Path $workspaceDirectory "orange-split-extension"
$manifest = Get-Content -LiteralPath (Join-Path $extensionDirectory "manifest.json") -Raw |
  ConvertFrom-Json
$zipPath = Join-Path $workspaceDirectory "orange-split-extension-$($manifest.version).zip"
$reportPath = Join-Path $workspaceDirectory "artifacts\extension-validation.json"
$maximumBytes = 20971520
$forbiddenExtensions = @(
  ".exe",
  ".sh",
  ".bat",
  ".cmd",
  ".php",
  ".jsp",
  ".py",
  ".map"
)

if (-not (Test-Path -LiteralPath $extensionDirectory -PathType Container)) {
  throw "Extension directory does not exist: $extensionDirectory"
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $extensionDirectory,
  $zipPath,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $fileEntries = @($archive.Entries | Where-Object { $_.Name -ne "" })
  $entryNames = @($fileEntries | ForEach-Object { $_.FullName.Replace("\", "/") })
  $caseFolded = @($entryNames | ForEach-Object { $_.ToLowerInvariant() })
  $duplicates = @(
    $caseFolded |
      Group-Object |
      Where-Object { $_.Count -gt 1 } |
      ForEach-Object { $_.Name }
  )
  $forbidden = @(
    $fileEntries |
      Where-Object {
        $forbiddenExtensions -contains
          [System.IO.Path]::GetExtension($_.FullName).ToLowerInvariant()
      } |
      ForEach-Object { $_.FullName }
  )
  $unsafePaths = @(
    $entryNames |
      Where-Object {
        $_.StartsWith("/") -or
        $_.StartsWith("\") -or
        $_.Split("/") -contains ".."
      }
  )
  $uncompressedBytes = ($fileEntries | Measure-Object -Property Length -Sum).Sum
  $zipBytes = (Get-Item -LiteralPath $zipPath).Length
  $manifestEntry = $fileEntries |
    Where-Object { $_.FullName -eq "manifest.json" } |
    Select-Object -First 1

  $errors = [System.Collections.Generic.List[string]]::new()
  if (-not $manifestEntry) {
    $errors.Add("ZIP root is missing manifest.json.")
  }
  if ($zipBytes -gt $maximumBytes) {
    $errors.Add("ZIP exceeds the 20 MB limit.")
  }
  if ($fileEntries.Count -gt 300) {
    $errors.Add("ZIP file count exceeds 300.")
  }
  if ($duplicates.Count -gt 0) {
    $errors.Add("ZIP has case-insensitive duplicate paths.")
  }
  if ($forbidden.Count -gt 0) {
    $errors.Add("ZIP contains forbidden file types.")
  }
  if ($unsafePaths.Count -gt 0) {
    $errors.Add("ZIP contains absolute or parent-directory paths.")
  }

  $report = [ordered]@{
    status = if ($errors.Count -eq 0) { "passed" } else { "failed" }
    packageType = "Chrome/Chromium Extension"
    manifestVersion = 3
    zipPath = $zipPath
    zipBytes = $zipBytes
    uncompressedBytes = $uncompressedBytes
    fileCount = $fileEntries.Count
    rootManifest = [bool]$manifestEntry
    caseConflicts = $duplicates
    forbiddenFiles = $forbidden
    unsafePaths = $unsafePaths
    errors = $errors
    checkedAt = (Get-Date).ToString("o")
  }

  $reportDirectory = Split-Path -Parent $reportPath
  if (-not (Test-Path -LiteralPath $reportDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $reportDirectory | Out-Null
  }
  $report | ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $reportPath -Encoding utf8
  $report | ConvertTo-Json -Depth 5

  if ($errors.Count -gt 0) {
    exit 1
  }
}
finally {
  $archive.Dispose()
}
