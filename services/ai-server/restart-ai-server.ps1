$connection = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if ($connection) {
    $ownerPid = $connection.OwningProcess
    Write-Host "Killing process $ownerPid on port 8787"
    Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

Write-Host "Starting AI server..."
$start = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
    -ArgumentList "src/server.mjs" `
    -WorkingDirectory "C:\Users\reece\Desktop\Kryeo\services\ai-server" `
    -WindowStyle Hidden `
    -PassThru

Start-Sleep -Seconds 4

Write-Host "Server PID: $($start.Id)"

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -TimeoutSec 5
    Write-Host "Health check response:"
    $health | ConvertTo-Json -Depth 3
} catch {
    Write-Host "Health check failed: $_"
}
