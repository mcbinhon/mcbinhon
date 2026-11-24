# CLAUDE.md — Memória do projeto "Agente de Vídeo pelo WhatsApp"

> Arquivo de memória para o Claude Code. Ele é carregado automaticamente quando você trabalha nesta pasta.
> Contém o objetivo, as decisões, a arquitetura, os formatos já conferidos, o estado atual e os próximos passos.
> **Responda sempre em português do Brasil.** O dono do projeto não é programador: explique em linguagem simples e dê comandos prontos para copiar.

---

## 1. Objetivo (palavras do dono)

- Ter um **número de WhatsApp do agente**. O dono manda mensagens do **celular particular** dele para esse número.
- Ao digitar a palavra **"edição"**, o agente inicia um pedido. Primeiro pede **foto ou conteúdo**, depois pede a **ideia (o prompt)**, com perguntas claras e objetivas.
- O vídeo é gerado no **computador do dono**, usando as **skills de motion graphics da iArt** instaladas no Claude Code, com a melhor capacidade possível.
- O vídeo é **devolvido no WhatsApp**.
- **Restrito só ao celular do dono**, por enquanto.
- Usar o **WhatsApp open source**: foi escolhida a **Evolution API**. O dono citou "WA AKG"; se ele quis dizer **WAHA**, trocar o cliente em `src/evolution.js`.
- Ter um **painel (dashboard) no computador** para acompanhar cada pedido: como foi conduzido e se foi entregue.
- Ter um **relatório de tokens** usados, por **dia, mês e ano**.

## 2. Contexto e origem

- As habilidades vêm do repositório público `iart-ai/motion-skills`. Ele é só um índice: as **56 skills** estão em **19 repositórios separados** da organização `iart-ai`.
- Os pacotes são: `tiktok-video-skills`, `text-message-video-skills`, `youtube-video-skills`, `ecommerce-video-skills`, `ad-video-skills`, `data-animation-skills`, `explainer-video-skills`, `map-animation-skills`, `web-animation-skills`, `motion-design-skills`, `kinetic-typography-skills`, `freelance-motion-skills`, `webgl-animation-skills`, `manim-skills`, `generative-illustration-skills`, `javascript-animation-skills`, `lower-thirds-skills`, `b-roll-skills`, `talking-head-skills`.
- Instalação conferida e funcionando: `npx -y skills add iart-ai/<pacote> -g -a claude-code -y`. Instala em `~/.claude/skills/<skill>` (no Windows, `%USERPROFILE%\.claude\skills`).
- Cada skill tem um `SKILL.md`, uma pasta `references/` e, nas que geram vídeo, um ciclo de "entregar e verificar": renderiza quadros, olha, corrige e confere o MP4 com ffprobe. Os vídeos são renderizados com Remotion, canvas/HTML + ffmpeg, ou Manim.
- O computador do dono é **Windows**. O repositório já tem outro projeto em PowerShell (`../monitor-rede/`). Por isso os scripts de instalação são `.ps1`.
- Repositório: `mcbinhon/mcbinhon`. Este projeto fica em `agente-video-whatsapp/`.

## 3. Arquitetura

```
Celular do dono ──► Número do agente (chip separado)
                         │
                Evolution API v2.3.7 (Docker: api + postgres + redis), porta 127.0.0.1:8080
                         │ webhook POST http://host.docker.internal:3333/webhook/<WEBHOOK_SECRET>
                Agente Node.js (este projeto), porta 3333
                  • whitelist de números  • conversa (máquina de estados)  • fila: 1 vídeo por vez
                         │ spawn: claude -p --output-format stream-json --verbose ... (prompt via stdin)
                Claude Code + skills iArt, cwd = dados/pedidos/<id>/  →  output/final.mp4
                         │
                Entrega via Evolution sendMedia (vídeo ou documento) + painel http://localhost:3333
```

- **Sem dependências npm.** Usa só Node ≥ 22.13: `node:sqlite`, `node:http` e `fetch`. O Chart.js 4.4.1 está copiado em `public/vendor/chart.umd.js`, então o painel funciona sem internet.
- Rodar: `npm start`, que executa `node --disable-warning=ExperimentalWarning src/index.js`.
- Teste: `npm run teste`.

### Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/config.js` | Lê o `.env` (`process.loadEnvFile`; `ENV_FILE` muda o caminho) e cria `dados/pedidos` |
| `src/db.js` | SQLite em `dados/agente.db`, tabelas `orders`, `events`, `media` e `usage`. Data/hora local `AAAA-MM-DD HH:MM:SS`, agrupada com `substr` |
| `src/evolution.js` | Cliente da Evolution: sendText, sendMedia, getMediaBase64, connect (QR), connectionState, logout, ensureInstance (cria a instância e configura o webhook) |
| `src/catalog.js` | **15 tipos de vídeo** → skills + perguntas. Perguntas comuns: formato, duração, música, estilo. É aqui que se edita o menu |
| `src/conversation.js` | Lê o webhook (`parseInbound`), aplica a whitelist (`authorized`, com e sem o 9º dígito), processa as mensagens de cada número em ordem e conduz a conversa |
| `src/agent.js` | Monta o prompt (`buildPrompt`, `buildRevisionPrompt`), executa o Claude Code, lê o stream-json (progresso, sessão, tokens) e encontra o arquivo de saída |
| `src/queue.js` | Fila em memória (restaurada do banco ao reiniciar), executa, grava o uso, entrega no WhatsApp e cuida dos ajustes (`--resume` da sessão, com reserva refazendo do zero) |
| `src/media.js` | Salva as mídias recebidas em `input/`, roda ffprobe e prepara o vídeo para o WhatsApp (comprime ou manda como documento) |
| `src/notify.js` | `say(order, text)`: envia a mensagem e registra o evento `saida` |
| `src/server.js` | Webhook e API do painel. O painel só abre em localhost, ou com `DASHBOARD_TOKEN` (via `?token=` e cookie) |
| `public/index.html` | Painel: indicadores, pedidos, gaveta de detalhes (vídeo, respostas, mídias, tokens, linha do tempo) e relatório de tokens (dia/mês/ano, datas, gráfico, por modelo, CSV) |
| `scripts/instalar.ps1` | Confere os programas, cria o `.env` com chaves aleatórias e pede o número, instala as 19 coleções de skills, o Chromium do Playwright e sobe o Docker |
| `scripts/iniciar.ps1` / `iniciar-com-windows.ps1` | Liga o agente / cria uma tarefa agendada para iniciar ao entrar no Windows |
| `scripts/teste-local.js` + `claude-falso.mjs` | Teste de ponta a ponta com Evolution e Claude falsos, sem gastar tokens |

Os `.ps1` estão salvos em **UTF-8 com BOM e quebra de linha CRLF**, para o PowerShell 5.1 ler os acentos. Manter assim.

## 4. Conversa no WhatsApp (máquina de estados)

`orders.status`: `coletando` → `na_fila` → `gerando` → `entregue` → `finalizado`. Outros estados possíveis: `falhou`, `cancelado`, `expirado`.
`orders.step`: `media` → `tipo` → `q:N` → `ideia` → `confirmar` → (produção) → `ajuste` → `confirmar_ajuste` → `fim`.

- **"edição"** (sem diferença de acento ou maiúsculas): cria um pedido novo. Um pedido que ainda estava em `coletando` é cancelado; um `entregue` vira `finalizado`.
- **Mídias:** aceitas em qualquer etapa. A confirmação é agrupada: espera 3,5 s e responde "Recebido! N foto(s)...".
- **"pronto"** (ou "pular", "nao tenho"...) mostra o menu. Se o tipo exige material (slideshow precisa de foto, b-roll de vídeo) e ele não veio, o agente volta a pedir.
- **Perguntas:** opções por número; *pular* usa o padrão (só nas opcionais); *voltar*; *menu* troca o tipo.
- **Ideia:** texto livre. Depois vem o resumo com *1* (gerar) ou *2* (corrigir). Qualquer outro texto é acrescentado à ideia.
- **Comandos globais:** `cancelar` (também interrompe a geração), `status`, `ajuda`/`oi`, `tentar` (repete um pedido que falhou).
- **Depois da entrega:** *ok* finaliza; outro texto vira pedido de ajuste, que precisa ser confirmado com *1*. Limite em `MAX_AJUSTES`. Depois de 48 h, o pedido entregue vira `finalizado` sozinho.
- Conversa parada por mais de `CONVERSA_EXPIRA_MIN` (120) vira `expirado`.
- Números não autorizados, grupos (`@g.us`), status e newsletter são **ignorados em silêncio** (aparecem só no console).
- Mensagens vazias (figurinha, reação, localização) são ignoradas.

## 5. Formatos conferidos (não adivinhar de novo)

### Evolution API v2.3.7 (imagem `evoapicloud/evolution-api:v2.3.7`; a antiga `atendai/` está desativada)
- Cabeçalho `apikey: <AUTHENTICATION_API_KEY>`. O limite de JSON do servidor é 136 MB.
- `POST /instance/create` com `{instanceName, integration:'WHATSAPP-BAILEYS', qrcode:true}`.
- `GET /instance/fetchInstances?instanceName=`, `GET /instance/connect/{inst}` → `{base64, pairingCode}`, `GET /instance/connectionState/{inst}` → `{instance:{state}}` (`open` = conectado), `DELETE /instance/logout/{inst}`.
- `POST /webhook/set/{inst}` com `{webhook:{enabled, url, byEvents:false, base64:true, events:['MESSAGES_UPSERT','CONNECTION_UPDATE','QRCODE_UPDATED']}}`.
- `POST /message/sendText/{inst}` com `{number, text}`; `POST /message/sendMedia/{inst}` com `{number, mediatype: image|video|document|audio, mimetype, caption, fileName, media: base64}`.
- `POST /chat/getBase64FromMediaMessage/{inst}` com `{message:{key:{id}}, convertToMp4:false}` → `{base64, mimetype, fileName}`. É a reserva quando o webhook chega sem base64.
- Webhook: `{event:'messages.upsert', instance, data:{key:{id, remoteJid, fromMe, remoteJidAlt?, addressingMode?}, pushName, message:{conversation | extendedTextMessage.text | imageMessage | videoMessage | audioMessage | documentMessage ..., base64?}, messageType}}`.
- Endereços **LID**: o `remoteJid` pode terminar em `@lid`; o número real fica em `remoteJidAlt`/`senderPn` (`@s.whatsapp.net`). O código já considera isso.

### Claude Code headless
- Linha de comando: `claude -p --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools Bash,Read,Write,Edit,MultiEdit,Glob,Grep,Skill,TodoWrite,WebFetch,WebSearch [--model X] [--add-dir MARCA_DIR] [--resume <session_id>]`. O prompt vai pela **stdin**, então nenhum texto do usuário entra na linha de comando; no Windows usa `shell:true` para achar o `claude.cmd`.
- Eventos: `system/init` (session_id, model); `assistant` com `message.content[]` de `tool_use` (name, input) e `text`; `result` com `result`, `is_error`, `duration_ms`, `num_turns`, `total_cost_usd`, `usage` e **`modelUsage`**: `{ "<modelo>": {inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD, ...} }`. A tabela `usage` grava uma linha por modelo e por execução (`run` 0 = geração, 1.. = ajustes).
- A saída só é aceita se o arquivo em `output/` foi modificado **durante esta execução**, para não reaproveitar um vídeo antigo num ajuste. Preferência: `output/final.mp4`; depois `final.mov`/`final.webm` mais `preview.mp4` (tarja transparente); depois o vídeo mais recente da pasta.

## 6. Prompt enviado ao agente (resumo das regras)

Monta: tipo + skills recomendadas (carregar com a ferramenta Skill) + respostas + ideia + lista de arquivos em `./input` + pasta de marca + `AGENT_EXTRA` + regras de entrega.
As regras pedem:
- trabalhar **só dentro da pasta**, com temporários em `./trabalho` (não usar `/tmp`);
- resolução e 30 fps, H.264 yuv420p + AAC + faststart;
- salvar em `./output/final.mp4`;
- textos em pt-BR, com preços e nomes exatamente como o cliente escreveu;
- respeitar as áreas seguras;
- fazer o ciclo de verificação (quadros de início, meio e fim mais ffprobe);
- não fazer perguntas;
- terminar com um resumo de 2 a 4 linhas, que vai para o cliente.

O ajuste usa `--resume` com o texto do ajuste. Se falhar (sem ter sido por tempo limite), o pedido é refeito do zero com o ajuste incluído.

## 7. Estado atual (validado)

- `npm run teste` **passa**. Cobre: número não autorizado ignorado, normalização do 9º dígito, 2 mídias (com e sem base64), pergunta obrigatória, conversa completa, entrega, ajuste com `--resume`, *ok*, *status*, painel, relatório de tokens e CSV, e cancelamento.
- **Teste real** com o Claude Code (modelo sonnet) e a skill `kinetic-typography`, tipo "texto": vídeo vertical de 8 s gerado corretamente (1080x1920, h264 + aac) em cerca de 158 s, com 322 mil tokens (a maioria cache), cerca de US$ 0,18. Nesse teste o agente usou `/tmp/w` como rascunho, o que levou à regra `./trabalho` acrescentada depois.
- O painel foi conferido com capturas de tela, nos temas claro e escuro e em celular (sem rolagem horizontal).
- **Ainda não testado:** WhatsApp real (QR code e envio pela Evolution de verdade) e os `.ps1` no Windows.

## 8. Limitações conhecidas e próximos passos possíveis

- A ideia precisa ser enviada em **texto**. Uma ideia mandada em áudio é guardada como material, mas não é transcrita. Próximo passo possível: transcrever com Whisper (o `ffmpeg` já está instalado).
- O resumo que vai para o cliente às vezes inclui frases do agente sobre a verificação. Daria para filtrar e enviar só o último parágrafo.
- A fila é sequencial (um vídeo por vez) e fica em memória; ao reiniciar, é restaurada a partir do banco.
- O limite de vídeo no WhatsApp é configurável (`MAX_WHATSAPP_VIDEO_MB`, 15). Acima disso o vídeo é comprimido; se não couber, vai como documento. Acima de cerca de 95 MB não é enviado (fica no painel).
- O custo vem do Claude Code com preço de tabela. Em assinatura Pro/Max é só referência; os tokens são reais.
- Skills que precisam de serviços pagos (`talking-head`: ElevenLabs e fal) não estão no menu.
- Ideias futuras: suporte a WAHA, vários números autorizados com perfis diferentes, transcrição de áudio, envio do link do painel pela rede.

## 9. Convenções

- Todo texto voltado ao usuário (WhatsApp, painel, documentação) em **pt-BR**, com acentos corretos.
- Não adicionar dependências npm sem necessidade (o projeto é propositalmente sem dependências).
- Depois de mudar a conversa, o catálogo ou a fila: rodar `npm run teste`. Se um comportamento mudar, atualizar o teste.
- Nunca commitar `.env` nem `dados/` (estão no `.gitignore`).
- Commits em português, descritivos.
