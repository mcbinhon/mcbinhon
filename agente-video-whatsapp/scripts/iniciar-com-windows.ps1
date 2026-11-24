# Faz o agente iniciar sozinho quando você entrar no Windows (opcional)
#   powershell -ExecutionPolicy Bypass -File .\scripts\iniciar-com-windows.ps1
$raiz = Split-Path -Parent $PSScriptRoot
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-WindowStyle Minimized -ExecutionPolicy Bypass -File `"$raiz\scripts\iniciar.ps1`"" -WorkingDirectory $raiz
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$conf = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Agente de Video WhatsApp' -Action $acao -Trigger $gatilho -Settings $conf -Force | Out-Null
Write-Host 'Pronto: o agente vai iniciar quando voce entrar no Windows.' -ForegroundColor Green
Write-Host 'Para remover:  Unregister-ScheduledTask -TaskName "Agente de Video WhatsApp"'
