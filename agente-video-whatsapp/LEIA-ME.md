# 🎬 Agente de Vídeo pelo WhatsApp

Você manda **edição** do seu WhatsApp particular para o número do agente. Ele pede o material e faz perguntas objetivas. Depois gera o vídeo no **seu computador**, com o **Claude Code** e as **56 skills de motion graphics da iArt**, e devolve o vídeo pronto no WhatsApp.

Um **painel no computador** mostra cada pedido: a conversa, os passos do agente, o vídeo entregue e o **relatório de tokens por dia, mês e ano**.

```
Seu celular ──"edição"──► Número do agente (chip separado)
                              │
                     Evolution API (Docker)  ← WhatsApp open source
                              │ webhook
                     Agente (Node.js, este projeto)
                       • só atende o SEU número
                       • conduz a conversa passo a passo
                       • fila: um vídeo por vez
                              │
                     Claude Code + skills iArt  →  output/final.mp4
                              │
Seu celular ◄──── vídeo ──────┘        Painel: http://localhost:3333
```

---

## 1. O que você precisa

| Item | Para quê | Como instalar (Windows) |
|---|---|---|
| **Um chip/número só para o agente** | É o "robô" que conversa com você | WhatsApp ou WhatsApp Business num celular qualquer |
| **Docker Desktop** | Roda a Evolution API | `winget install Docker.DockerDesktop` |
| **Node.js 22.13+** | Roda o agente e o painel | `winget install OpenJS.NodeJS.LTS` |
| **ffmpeg** | Confere e comprime os vídeos | `winget install Gyan.FFmpeg` |
| **Git** | Baixa as skills | `winget install Git.Git` |
| **Claude Code** (logado) | Gera os vídeos | `irm https://claude.ai/install.ps1 \| iex` e depois rode `claude` uma vez para entrar na sua conta |

> ⚠️ **Não use o seu número pessoal como agente.** A Evolution API não é oficial da Meta. O risco de bloqueio é baixo, porque o agente só conversa com você, mas existe.

## 2. Instalação (uma vez só)

Abra o **PowerShell** na pasta `agente-video-whatsapp` e rode:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1
```

O script:
1. confere se todos os programas acima estão instalados;
2. cria o `.env` com chaves aleatórias e pede **o seu número particular**, o único que poderá usar o agente;
3. instala as **19 coleções de skills** da iArt no Claude Code (`%USERPROFILE%\.claude\skills`);
4. instala o navegador que as skills usam para conferir os quadros do vídeo;
5. sobe a Evolution API no Docker.

## 3. Ligar e conectar o WhatsApp

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\iniciar.ps1
```

O painel abre em **http://localhost:3333**. Clique em **Conectar WhatsApp** e, no celular do **número do agente**, vá em *WhatsApp → Aparelhos conectados → Conectar um aparelho* e leia o QR code.

Para o agente iniciar sozinho quando você ligar o PC:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\iniciar-com-windows.ps1
```

> O computador precisa ficar **ligado** e com o **Docker Desktop aberto** para o agente responder.

## 4. Como usar (no seu celular)

| Você manda | O agente faz |
|---|---|
| **edição** | Abre um pedido novo e pede o material |
| fotos, vídeos, áudios, logo | Guarda tudo e confirma o que recebeu |
| **pronto** | Mostra o menu de tipos de vídeo |
| número do tipo | Faz as perguntas daquele tipo, uma por vez (*pular* para usar o padrão, *voltar* para voltar uma pergunta) |
| sua ideia, em texto livre | Este é o "prompt": quanto mais detalhe, melhor |
| **1** | Confirma, coloca na fila e avisa quando começar |
| — | Manda o vídeo pronto no WhatsApp |
| **ok** | Finaliza o pedido |
| qualquer texto de ajuste | Ex.: *"deixa o texto maior e o fundo azul"*. Confirme com **1** e ele refaz em cima do mesmo projeto |
| **status** | Lista seus últimos pedidos |
| **cancelar** | Cancela o pedido atual, mesmo durante a geração |
| **tentar** | Tenta de novo um pedido que falhou |

### Tipos de vídeo no menu (e as skills usadas)

| # | Tipo | Perguntas | Skills principais |
|---|---|---|---|
| 1 | Slideshow de fotos | título, ocasião | photo-slideshow, beat-sync-editing, soundtrack |
| 2 | Promoção / oferta | produto, preço de/por, validade, contato | promo-video, kinetic-typography, motion-background |
| 3 | Reels / TikTok com legenda | tema, gancho | short-form-video, caption-animation |
| 4 | Apresentação de produto / app | produto, benefícios, chamada | product-demo-video, launch-video |
| 5 | Depoimento de cliente | texto, autor, estrelas | testimonial-video |
| 6 | Anúncio para redes | oferta, público, chamada | ad-creative-video, video-delivery-specs |
| 7 | Vídeo explicativo | assunto, público | explainer-video, diagram-animation, whiteboard-animation |
| 8 | Gráfico / números | dados, título | chart-animation, animated-infographic |
| 9 | Frase / texto animado | texto | kinetic-typography |
| 10 | Animação desenhada | história | javascript-animation, soundtrack |
| 11 | B-roll no seu vídeo falando | legenda? | talking-head-b-roll, caption-animation |
| 12 | Tarja de nome transparente | nome, linha 2 | lower-thirds (entrega .mov com transparência + prévia) |
| 13 | Contagem regressiva | evento, tempo | countdown-video |
| 14 | Conversa de WhatsApp animada | roteiro | text-message-animation |
| 15 | Livre | — | o agente escolhe |

Todos os tipos também perguntam **formato** (9:16, 1:1 ou 16:9), **duração**, **música** (trilha criada em código, sem música ou o seu áudio) e **estilo/cores**.
Para mudar as perguntas ou criar tipos novos, edite `src/catalog.js`.

## 5. O painel (http://localhost:3333)

- **Topo:** se o WhatsApp está conectado e como está a fila.
- **Indicadores:** pedidos hoje, em andamento, entregues no mês, tokens de hoje, do mês e do ano (em US$ e R$).
- **Pedidos:** filtre por status ou busque. Ao clicar num pedido você vê:
  - o vídeo entregue (com botão **Reenviar vídeo**);
  - as respostas, a ideia, o material recebido e as skills usadas;
  - os tokens de cada execução (geração e cada ajuste, por modelo);
  - **"Como foi conduzido"**: a linha do tempo de tudo o que aconteceu, com mensagens recebidas, respostas do agente, cada passo do Claude (skills carregadas, comandos, arquivos criados) e erros;
  - links para o **prompt exato** enviado ao Claude e o **log completo**;
  - botões **Cancelar** e **Gerar de novo**.
- **Relatório de tokens:** agrupado por **Dia, Mês ou Ano**, com filtro de datas, gráfico (entrada, saída, cache de leitura e escrita, mais a linha de custo), tabela com totais, divisão **por modelo** e **exportação para CSV** (abre no Excel).

> O custo vem do próprio Claude Code, pelo preço de tabela da API. Se você usa assinatura Pro/Max, trate o valor como referência; os **tokens** são os reais.

O painel só abre **no próprio computador**. Para abrir de outro PC da rede, defina `DASHBOARD_TOKEN` no `.env` e acesse `http://IP-DO-PC:3333/?token=SUA_SENHA`.

## 6. Configurações úteis (`.env`)

| Variável | O que faz |
|---|---|
| `ALLOWED_NUMBERS` | Números que podem usar o agente (aceita com ou sem o 9º dígito) |
| `TRIGGER_WORD` | Palavra que inicia o pedido (padrão `edição`; aceita com ou sem acento e maiúsculas) |
| `CLAUDE_MODEL` | Força um modelo (`opus`, `sonnet`...). Vazio usa o padrão da sua conta |
| `JOB_TIMEOUT_MIN` | Tempo máximo por vídeo (padrão 45 min) |
| `MARCA_DIR` | Pasta com logo, cores e fontes da sua marca, que o agente usa quando fizer sentido |
| `AGENT_EXTRA` | Instrução fixa para todo vídeo (ex.: *"sempre termine com o logo da Farmácia X"*) |
| `MAX_WHATSAPP_VIDEO_MB` | Acima disso o vídeo é comprimido. Se não couber, vai como documento, sem perda |
| `MAX_AJUSTES` | Quantos ajustes por pedido |
| `USD_BRL` | Cotação usada para mostrar custo em reais |

## 7. Segurança

- Mensagens de **qualquer outro número**, de grupos e de status são **ignoradas em silêncio**.
- A Evolution API só escuta em `localhost` (porta 8080). O webhook exige um segredo na URL.
- O Claude Code trabalha **só dentro da pasta do pedido** (`dados/pedidos/<nº>`), com uma lista fixa de ferramentas.
- Tudo fica no seu PC: banco de dados `dados/agente.db`, mídias recebidas e vídeos gerados em `dados/pedidos/`.

## 8. Testar sem WhatsApp e sem gastar tokens

```powershell
npm run teste
```

Simula a Evolution API e o Claude e faz uma conversa completa: pedido, perguntas, entrega, ajuste, finalização, relatório de tokens e CSV.

## 9. Problemas comuns

| Sintoma | Solução |
|---|---|
| Painel mostra "Evolution API offline" | Abra o Docker Desktop e rode `docker compose up -d` |
| Mandei "edição" e nada acontece | Confira se o número em `ALLOWED_NUMBERS` é o seu, com 55 e o DDD. Veja se a janela do agente mostra `[ignorado]` |
| "O agente terminou sem gerar o vídeo" | Abra o pedido no painel e veja **Log completo do agente**. Confira se você fez login no Claude Code (`claude` no terminal) |
| Vídeo chega como documento | Ele passou do limite do WhatsApp. É normal em vídeos longos e não perde qualidade |
| Quero trocar o número do agente | No painel: desconecte, ou rode `docker compose down -v` (apaga a sessão) e conecte de novo |

## Estrutura

```
agente-video-whatsapp/
├── docker-compose.yml        Evolution API + Postgres + Redis
├── .env.example              configurações (copiado para .env)
├── src/
│   ├── index.js              inicia tudo
│   ├── server.js             webhook + API do painel
│   ├── conversation.js       roteiro da conversa no WhatsApp
│   ├── catalog.js            tipos de vídeo, perguntas e skills
│   ├── agent.js              chama o Claude Code e lê progresso e tokens
│   ├── queue.js              fila, entrega e ajustes
│   ├── media.js              salvar mídias, ffprobe, compressão
│   ├── evolution.js          cliente da Evolution API
│   └── db.js                 banco SQLite (pedidos, eventos, mídias, tokens)
├── public/index.html         painel
└── scripts/
    ├── instalar.ps1          instalação no Windows
    ├── iniciar.ps1           liga o agente
    ├── iniciar-com-windows.ps1
    └── teste-local.js        teste de ponta a ponta
```
