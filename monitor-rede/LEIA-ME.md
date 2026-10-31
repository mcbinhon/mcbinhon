# Monitor de Rede – Filial Cruzeiro

Servidor monitorado: **192.168.0.50**

## O que faz
A cada 60 s, em cada computador onde for instalado, testa:

| Teste | Se falhar, significa |
|---|---|
| PC → roteador | Problema no próprio PC (cabo, Wi-Fi, placa) |
| PC → internet | Link/operadora da filial |
| PC → servidor | Servidor desligado ou VPN fora |

- Alerta só após **3 falhas seguidas** (sem alarme falso) e avisa quando **normaliza**, com o tempo fora.
- Avisa **instabilidade** (lentidão/perdas em 4 de 10 testes).
- Não altera nada na rede ou no computador – apenas testa e registra.

## Instalação (em cada PC, como Administrador)
1. Copie a pasta `monitor-rede` para o computador.
2. (Opcional) Edite o topo de `monitor-rede.ps1`: porta do sistema, Telegram.
3. Execute: `powershell -ExecutionPolicy Bypass -File instalar.ps1`

Remover: `powershell -ExecutionPolicy Bypass -File instalar.ps1 -Remover`

## Logs
- `C:\MonitorRede\log-<PC>.csv` – todos os testes (abre no Excel)
- `C:\MonitorRede\eventos-<PC>.txt` – só quedas, retornos e instabilidades

## Alertas no celular (Telegram)
1. No Telegram, fale com **@BotFather** → `/newbot` → copie o *token*.
2. Mande qualquer mensagem para o seu bot e abra
   `https://api.telegram.org/bot<TOKEN>/getUpdates` → copie o `chat.id`.
3. Preencha `$TelegramToken` e `$TelegramChatId` no script.
