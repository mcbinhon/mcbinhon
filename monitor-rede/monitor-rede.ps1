<#
  Monitor de Rede - Filial Cruzeiro
  ---------------------------------
  Testa a cada intervalo:
    1) PC -> roteador (gateway)  : falha aqui = problema no proprio PC (cabo/Wi-Fi/placa)
    2) PC -> internet            : falha aqui = link/operadora
    3) PC -> servidor            : falha so aqui = servidor ou VPN
  Registra tudo em log (CSV) e avisa (Telegram e/ou popup) quando cai e quando volta.
  Somente LEITURA da rede: nao altera nenhuma configuracao do computador.
#>

# ===================== CONFIGURACAO =====================
$Servidor          = "192.168.0.50"   # IP do servidor da filial Cruzeiro
$PortaServidor     = 0                # Porta do sistema (ex.: 1433, 3050, 3306). 0 = testa so ping
$Internet          = "8.8.8.8"        # Alvo para testar internet
$IntervaloSeg      = 60               # Intervalo entre testes
$FalhasParaAlerta  = 3                # Falhas seguidas antes de alertar (evita alarme falso)
$LatenciaAltaMs    = 150              # Acima disso conta como "lento"
$TimeoutMs         = 2000

# Telegram (opcional). Deixe vazio para nao usar.
$TelegramToken     = ""
$TelegramChatId    = ""

$PopupLocal        = $false           # $true = mostra janela de aviso no proprio PC
$PastaLog          = "C:\MonitorRede"
# ========================================================

$ErrorActionPreference = "SilentlyContinue"
$Pc      = $env:COMPUTERNAME
$LogCsv  = Join-Path $PastaLog "log-$Pc.csv"
$LogEvt  = Join-Path $PastaLog "eventos-$Pc.txt"
New-Item -ItemType Directory -Path $PastaLog -Force | Out-Null
if (-not (Test-Path $LogCsv)) {
    "DataHora;Gateway;GatewayMs;Internet;InternetMs;Servidor;ServidorMs;Porta;Diagnostico" | Out-File $LogCsv -Encoding UTF8
}

function Get-Gateway {
    $r = Get-NetRoute -DestinationPrefix "0.0.0.0/0" | Sort-Object RouteMetric | Select-Object -First 1
    if ($r) { return $r.NextHop }
    return $null
}

function Test-Ping($alvo) {
    if (-not $alvo) { return @{ Ok = $false; Ms = -1 } }
    $p = New-Object System.Net.NetworkInformation.Ping
    try {
        $res = $p.Send($alvo, $TimeoutMs)
        if ($res.Status -eq "Success") { return @{ Ok = $true; Ms = [int]$res.RoundtripTime } }
    } catch {}
    return @{ Ok = $false; Ms = -1 }
}

function Test-Porta($alvo, $porta) {
    if ($porta -le 0) { return $null }
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $t = $c.ConnectAsync($alvo, $porta)
        return ($t.Wait($TimeoutMs) -and $c.Connected)
    } catch { return $false } finally { $c.Close() }
}

function Send-Alerta($texto) {
    $msg = "[$Pc] $texto"
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File $LogEvt -Append -Encoding UTF8
    Write-Host $msg
    if ($TelegramToken -and $TelegramChatId) {
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$TelegramToken/sendMessage" `
                -Body @{ chat_id = $TelegramChatId; text = $msg } | Out-Null
        } catch {}
    }
    if ($PopupLocal) { msg.exe * /TIME:30 $msg 2>$null }
}

$falhas   = 0
$emFalha  = $false
$inicioFalha = $null
$lentos   = New-Object System.Collections.Generic.Queue[bool]
$avisouInstavel = $false

Send-Alerta "Monitor iniciado. Servidor: $Servidor$(if($PortaServidor){":$PortaServidor"})"

while ($true) {
    $gw   = Get-Gateway
    $tGw  = Test-Ping $gw
    $tNet = Test-Ping $Internet
    $tSrv = Test-Ping $Servidor
    $porta = Test-Porta $Servidor $PortaServidor

    $srvOk = $tSrv.Ok -and ($porta -ne $false)

    if ($srvOk)              { $diag = "OK" }
    elseif (-not $tGw.Ok)    { $diag = "Sem rede local neste PC (cabo/Wi-Fi/placa de rede)" }
    elseif (-not $tNet.Ok)   { $diag = "Sem internet/link da filial - servidor inacessivel" }
    elseif ($tSrv.Ok -and $porta -eq $false) { $diag = "Servidor responde ping, mas o sistema (porta $PortaServidor) esta fora" }
    else                     { $diag = "Rede e internet OK, mas servidor nao responde (servidor desligado ou VPN)" }

    "{0};{1};{2};{3};{4};{5};{6};{7};{8}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"),
        $tGw.Ok, $tGw.Ms, $tNet.Ok, $tNet.Ms, $tSrv.Ok, $tSrv.Ms, $porta, $diag |
        Out-File $LogCsv -Append -Encoding UTF8

    if (-not $srvOk) {
        $falhas++
        if (-not $emFalha -and $falhas -ge $FalhasParaAlerta) {
            $emFalha = $true
            $inicioFalha = (Get-Date).AddSeconds(-($IntervaloSeg * ($falhas - 1)))
            Send-Alerta "FALHA de comunicacao com o servidor $Servidor. Diagnostico: $diag"
        }
    } else {
        if ($emFalha) {
            $dur = (Get-Date) - $inicioFalha
            Send-Alerta ("NORMALIZADO. Comunicacao com $Servidor voltou. Tempo fora: {0:hh\:mm\:ss}" -f $dur)
        }
        $falhas = 0; $emFalha = $false
    }

    # Instabilidade: lentidao/perdas em pelo menos 4 dos ultimos 10 testes
    $lentos.Enqueue( (-not $tSrv.Ok) -or ($tSrv.Ms -gt $LatenciaAltaMs) )
    if ($lentos.Count -gt 10) { [void]$lentos.Dequeue() }
    $qtdRuins = @($lentos | Where-Object { $_ }).Count
    if (-not $emFalha -and $qtdRuins -ge 4 -and -not $avisouInstavel) {
        Send-Alerta "INSTABILIDADE com o servidor $Servidor : $qtdRuins de 10 testes lentos (> $LatenciaAltaMs ms) ou perdidos."
        $avisouInstavel = $true
    } elseif ($qtdRuins -le 1) { $avisouInstavel = $false }

    Start-Sleep -Seconds $IntervaloSeg
}
