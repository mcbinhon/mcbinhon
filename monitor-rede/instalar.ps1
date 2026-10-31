<#
  Instala o Monitor de Rede como tarefa agendada (inicia junto com o Windows, roda em segundo plano).
  Executar como ADMINISTRADOR:  powershell -ExecutionPolicy Bypass -File instalar.ps1
  Para remover:                 powershell -ExecutionPolicy Bypass -File instalar.ps1 -Remover
#>
param([switch]$Remover)

$Pasta  = "C:\MonitorRede"
$Tarefa = "MonitorRedeCruzeiro"

if ($Remover) {
    Unregister-ScheduledTask -TaskName $Tarefa -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Tarefa '$Tarefa' removida. Os logs continuam em $Pasta."
    exit
}

New-Item -ItemType Directory -Path $Pasta -Force | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot "monitor-rede.ps1") -Destination $Pasta -Force

$acao   = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Pasta\monitor-rede.ps1`""
$gatilho = New-ScheduledTaskTrigger -AtStartup
$conf   = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit (New-TimeSpan -Days 0) -StartWhenAvailable
$usuario = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

Register-ScheduledTask -TaskName $Tarefa -Action $acao -Trigger $gatilho -Settings $conf -Principal $usuario -Force | Out-Null
Start-ScheduledTask -TaskName $Tarefa

Write-Host "Monitor instalado e rodando. Logs em $Pasta"
