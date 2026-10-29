$ErrorActionPreference = 'Stop'
$siteRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$dist = [IO.Path]::GetFullPath((Join-Path $siteRoot 'dist'))
if (!$dist.StartsWith($siteRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $dist -PathType Container)) {
  throw 'Missing a dist directory inside the website workspace.'
}
$date = Get-Date -Format 'yyyy-MM-dd-HHmmss'
$archivePath = Join-Path $siteRoot "JobSense-CloudBase-Static-$date.zip"
if (Test-Path -LiteralPath $archivePath) { throw "Archive already exists; stopped to avoid overwriting it: $archivePath" }
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $archivePath -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $names = $archive.Entries.FullName
  if (!($names -contains 'index.html') -or !($names -contains 'account.html')) { throw 'Archive is missing the app or account preview entry.' }
  if ($names | Where-Object { $_ -match '(^|/)\.env($|\.)|(^|/)node_modules/' }) { throw 'Archive contains local configuration or dependencies.' }
  Write-Output "Packaged $($archive.Entries.Count) static files."
  Write-Output $archivePath
} finally { $archive.Dispose() }
