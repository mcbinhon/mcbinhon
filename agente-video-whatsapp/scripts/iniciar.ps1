# Inicia o Agente de Vídeo (Evolution API + agente + painel)
#   powershell -ExecutionPolicy Bypass -File .\scripts\iniciar.ps1
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
docker compose up -d | Out-Null
$porta = (Select-String -Path .env -Pattern '^PORT=(\d+)' -ErrorAction SilentlyContinue).Matches.Groups[1].Value
if (-not $porta) { $porta = 3333 }
Start-Job { Start-Sleep 4; Start-Process "http://localhost:$using:porta" } | Out-Null
Write-Host "Agente iniciando... painel em http://localhost:$porta  (feche esta janela para parar)" -ForegroundColor Green
node --disable-warning=ExperimentalWarning src/index.js
