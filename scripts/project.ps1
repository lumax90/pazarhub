param(
  [ValidateSet('dev','dev:api','dev:full','build','build:all','build:server','start','worker','preview','lint','test','test:e2e','format','format:check')]
  [string]$Task = 'dev'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cacheRoot = Join-Path $env:LOCALAPPDATA 'Temp\opencode'
$portableRuntime = Join-Path $cacheRoot 'node-v24.22.1-win-x64'
$systemNode = Get-Command node.exe -ErrorAction SilentlyContinue

if ($systemNode) {
  $node = $systemNode.Source
} elseif (Test-Path (Join-Path $portableRuntime 'node.exe')) {
  $node = Join-Path $portableRuntime 'node.exe'
} else {
  throw 'Node.js bulunamadi. Node.js 24 LTS kurup komutu tekrar calistirin: https://nodejs.org/'
}

$runtime = Split-Path -Parent $node
$env:PATH = "$runtime;$env:PATH"
$npmCli = Join-Path $runtime 'node_modules\npm\bin\npm-cli.js'
$version = [version]((& $node --version).TrimStart('v'))
if ($version -lt [version]'22.22.0') { throw 'Bu proje Node.js 22.22 veya daha yeni bir surum gerektirir.' }

if ($Task -eq 'test:e2e') {
  $browsers = Join-Path $cacheRoot 'playwright-browsers'
  if ((-not $env:PLAYWRIGHT_BROWSERS_PATH) -and (Test-Path $browsers)) {
    $env:PLAYWRIGHT_BROWSERS_PATH = $browsers
  }
}

if (Test-Path $npmCli) {
  & $node $npmCli --prefix $projectRoot run $Task
} else {
  $npm = Get-Command npm.cmd -ErrorAction Stop
  & $npm.Source --prefix $projectRoot run $Task
}
exit $LASTEXITCODE
