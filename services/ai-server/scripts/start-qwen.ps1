param(
  [Parameter(Mandatory = $true)]
  [string]$LlamaServer,
  [Parameter(Mandatory = $true)]
  [string]$Model,
  [Parameter(Mandatory = $true)]
  [string]$Mmproj,
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
$serverPath = (Resolve-Path -LiteralPath $LlamaServer).Path
$modelPath = (Resolve-Path -LiteralPath $Model).Path
$mmprojPath = (Resolve-Path -LiteralPath $Mmproj).Path

& $serverPath `
  --host 127.0.0.1 `
  --port $Port `
  --model $modelPath `
  --mmproj $mmprojPath `
  --ctx-size 8192 `
  --parallel 2 `
  --n-gpu-layers 99 `
  --jinja
