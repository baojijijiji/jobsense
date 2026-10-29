param([Parameter(Mandatory=$true)][string]$SourceDirectory)
$ErrorActionPreference = 'Stop'
$siteRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePath = [IO.Path]::GetFullPath($SourceDirectory)
$allowedBuildRoot = [IO.Path]::GetFullPath((Join-Path $siteRoot '.vercel-ai-build'))
if (!$sourcePath.StartsWith($allowedBuildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected AI package source.' }
$packageRoot = Join-Path (Split-Path $siteRoot -Parent) '发布包'
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
$archivePath = Join-Path $packageRoot ('JobSense-Vercel-AI-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss') + '.zip')
Compress-Archive -Path (Join-Path $sourcePath '*') -DestinationPath $archivePath -CompressionLevel Optimal
Add-Type -AssemblyName System.IO.Compression
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $expected = @('api/ai.js','server/accountAiGateway.js','server/resumeAi.js','public/index.html','build.mjs','package.json','vercel.json')
  $names = @($archive.Entries | ForEach-Object { $_.FullName.Replace([char]92, [char]47) })
  foreach ($entryName in $names) {
    if (!$entryName.EndsWith("/") -and ($expected -notcontains $entryName)) { throw "Unexpected file in AI package." }
  }
  foreach ($name in $expected) { if ($name -notin $names) { throw "Missing file: $name" } }
  Write-Output "Packaged $($expected.Count) AI source files, without local credentials."
  Write-Output $archivePath
} finally { $archive.Dispose() }
