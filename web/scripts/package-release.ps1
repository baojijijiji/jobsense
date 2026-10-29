$ErrorActionPreference = 'Stop'
$siteRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectRoot = [IO.Path]::GetDirectoryName($siteRoot)
$releaseRoot = Join-Path $projectRoot '发布包'
[IO.Directory]::CreateDirectory($releaseRoot) | Out-Null
$archivePath = Join-Path $releaseRoot 'JobSense-线上部署源码.zip'

$rootFiles = @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vercel.json', 'index.html', 'account.html',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vite.config.ts',
  '.gitignore', '.vercelignore', '.env.example', '.oxlintrc.json', 'README.md')
$sourceFiles = [Collections.Generic.List[string]]::new()
foreach ($relative in $rootFiles) {
  $sourceFiles.Add((Join-Path $siteRoot $relative))
}
foreach ($directory in @('src', 'server', 'api', 'scripts', 'tests', 'public', 'database')) {
  Get-ChildItem -LiteralPath (Join-Path $siteRoot $directory) -File -Recurse |
    Where-Object { $_.FullName -notlike "$(Join-Path $siteRoot 'public\pdf-assets')\*" } |
    ForEach-Object { $sourceFiles.Add($_.FullName) }
}

Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
  foreach ($path in $sourceFiles) {
    $absolute = [IO.Path]::GetFullPath($path)
    if (!$absolute.StartsWith($siteRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw '发布文件不在网站源码目录内。'
    }
    if (!(Test-Path -LiteralPath $absolute -PathType Leaf)) { throw "缺少发布文件：$absolute" }
    if ((Get-Item -LiteralPath $absolute).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '发布文件不能是目录链接。' }
    $relative = $absolute.Substring($siteRoot.Length + 1).Replace('\', '/')
    if ($relative -match '(?i)(^|/)(node_modules|\.node_modules-stale|\.git|\.vercel|dist)/|(^|/)\.env(?!\.example$)|\.local$|\.log$') {
      throw '发现不应发布的文件，已停止打包。'
    }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $absolute, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose() }

$check = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  if (!($check.Entries.FullName -contains 'vercel.json') -or !($check.Entries.FullName -contains 'api/handler.ts')) {
    throw '发布包缺少部署配置。'
  }
  Write-Output "已生成发布包，共 $($check.Entries.Count) 个源码文件；未包含本机密钥或浏览器资料。"
  Write-Output $archivePath
} finally { $check.Dispose() }
