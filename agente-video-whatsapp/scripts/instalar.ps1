# ============================================================
#  Agente de Vídeo pelo WhatsApp — instalação (Windows)
#  Rode no PowerShell, dentro da pasta agente-video-whatsapp:
#     powershell -ExecutionPolicy Bypass -File .\scripts\instalar.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

function Ok($t)    { Write-Host "  [ok] $t" -ForegroundColor Green }
function Falta($t) { Write-Host "  [faltando] $t" -ForegroundColor Yellow }
function Titulo($t){ Write-Host "`n== $t ==" -ForegroundColor Cyan }

Titulo 'Conferindo programas necessarios'
$faltando = @()

if (Get-Command node -ErrorAction SilentlyContinue) {
  $v = (node -v).TrimStart('v').Split('.')
  if ([int]$v[0] -gt 22 -or ([int]$v[0] -eq 22 -and [int]$v[1] -ge 13)) { Ok "Node.js $(node -v)" }
  else { Falta "Node.js 22.13 ou mais novo (voce tem $(node -v))  ->  winget install OpenJS.NodeJS.LTS"; $faltando += 'node' }
} else { Falta 'Node.js  ->  winget install OpenJS.NodeJS.LTS'; $faltando += 'node' }

if (Get-Command docker -ErrorAction SilentlyContinue) { Ok 'Docker' }
else { Falta 'Docker Desktop  ->  winget install Docker.DockerDesktop  (depois abra o Docker Desktop)'; $faltando += 'docker' }

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Ok 'ffmpeg' }
else { Falta 'ffmpeg  ->  winget install Gyan.FFmpeg'; $faltando += 'ffmpeg' }

if (Get-Command claude -ErrorAction SilentlyContinue) { Ok 'Claude Code' }
else { Falta 'Claude Code  ->  irm https://claude.ai/install.ps1 | iex   (depois rode "claude" uma vez para fazer login)'; $faltando += 'claude' }

if (Get-Command git -ErrorAction SilentlyContinue) { Ok 'Git' }
else { Falta 'Git (usado para baixar as skills)  ->  winget install Git.Git'; $faltando += 'git' }

if ($faltando.Count) {
  Write-Host "`nInstale o que esta faltando, FECHE e abra o PowerShell de novo, e rode este script outra vez." -ForegroundColor Yellow
  exit 1
}

Titulo 'Configurando o arquivo .env'
if (-not (Test-Path .env)) {
  $env_ = Get-Content .env.example -Raw -Encoding UTF8
  $chave = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
  $segredo = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  $env_ = $env_.Replace('troque-por-uma-chave-longa-e-secreta', $chave).Replace('troque-este-segredo-do-webhook', $segredo)
  Write-Host 'Qual o SEU numero de WhatsApp (o particular, que vai PEDIR os videos)?'
  $num = Read-Host 'Formato 55 + DDD + numero, ex.: 5541999998888'
  $num = ($num -replace '\D', '')
  $env_ = $env_ -replace '(?m)^ALLOWED_NUMBERS=.*$', "ALLOWED_NUMBERS=$num"
  [IO.File]::WriteAllText((Join-Path $raiz '.env'), $env_, (New-Object Text.UTF8Encoding $false))
  Ok '.env criado com chaves aleatorias'
} else { Ok '.env ja existe (mantido)' }

Titulo 'Instalando as 19 colecoes de skills da iArt no Claude Code'
$pacotes = 'tiktok-video-skills','text-message-video-skills','youtube-video-skills','ecommerce-video-skills',
  'ad-video-skills','data-animation-skills','explainer-video-skills','map-animation-skills','web-animation-skills',
  'motion-design-skills','kinetic-typography-skills','freelance-motion-skills','webgl-animation-skills','manim-skills',
  'generative-illustration-skills','javascript-animation-skills','lower-thirds-skills','b-roll-skills','talking-head-skills'
foreach ($p in $pacotes) {
  Write-Host "  - iart-ai/$p"
  npx -y skills add "iart-ai/$p" -g -a claude-code -y | Out-Null
  if ($LASTEXITCODE -ne 0) { Falta "falhou: iart-ai/$p (tente de novo depois)" }
}
Ok 'skills instaladas em %USERPROFILE%\.claude\skills'

Titulo 'Navegador para o agente conferir os quadros do video (Playwright)'
npx -y playwright install chromium | Out-Null
Ok 'Chromium do Playwright'

Titulo 'Subindo a Evolution API (WhatsApp) no Docker'
docker compose up -d
if ($LASTEXITCODE -ne 0) { Falta 'Nao consegui subir o Docker. O Docker Desktop esta aberto?'; exit 1 }
Ok 'Evolution API rodando em http://localhost:8080'

Write-Host "`nPronto! Agora rode:  .\scripts\iniciar.ps1" -ForegroundColor Green
Write-Host 'No painel que abrir, clique em "Conectar WhatsApp" e leia o QR code com o celular do NUMERO DO AGENTE.'
