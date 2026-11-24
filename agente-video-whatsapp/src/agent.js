// Executa o Claude Code em modo automático (headless) dentro da pasta do pedido,
// com as skills da iArt instaladas, e captura progresso + tokens.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ANSWER_LABELS, findType, labelFor } from './catalog.js';
import { config } from './config.js';

export const jobDir = (orderId) => path.join(config.jobsDir, String(orderId));

const ALLOWED_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Skill', 'TodoWrite', 'WebFetch', 'WebSearch'];

const KIND_PT = { imagem: 'imagem', video: 'vídeo', audio: 'áudio', documento: 'documento' };

function materialList(media) {
  if (!media.length) return '- (nenhum arquivo enviado — crie tudo do zero)';
  return media
    .map((m) => `- ${m.file} (${KIND_PT[m.kind] || m.kind}${m.mimetype ? `, ${m.mimetype}` : ''})${m.caption ? ` — legenda do cliente: "${m.caption}"` : ''}`)
    .join('\n');
}

function deliveryRules(order) {
  const a = order.answers;
  const type = findType(order.video_type);
  const isTarja = order.video_type === 'tarja';
  const res = a.formato || '1080x1920';
  const dur = a.duracao && a.duracao !== 'livre' ? `cerca de ${a.duracao} segundos` : 'a duração que o conteúdo pedir (curta e objetiva)';
  const music =
    { trilha_gerada: 'crie uma trilha original em código (skill soundtrack), suave no início e sem sustos de volume',
      sem_musica: 'sem música',
      audio_enviado: 'use o áudio enviado pelo cliente como trilha/narração' }[a.musica] || 'trilha original em código (skill soundtrack)';
  const lines = [
    'Trabalhe SOMENTE dentro desta pasta (e da pasta de marca, se informada). Arquivos temporários, quadros e projetos vão em ./trabalho (NÃO use /tmp nem outras pastas). Não apague nada fora daqui.',
    isTarja
      ? 'Entregue a tarja com fundo transparente em ./output/final.mov (ProRes 4444) E uma prévia sobre fundo escuro em ./output/preview.mp4 (H.264).'
      : `Resolução ${res}, 30 fps, H.264 (yuv420p) + áudio AAC, com -movflags +faststart. Duração: ${dur}.`,
    isTarja ? '' : 'Salve o vídeo final EXATAMENTE em ./output/final.mp4.',
    `Música: ${music}.`,
    'Todo texto na tela em português do Brasil, sem erros de ortografia. Preços, nomes, datas e números EXATAMENTE como o cliente escreveu.',
    'Use o material enviado (pasta ./input) como conteúdo principal quando houver. Nunca invente logotipos de marcas reais.',
    'Respeite as áreas seguras do formato (nada importante cortado nas bordas ou atrás da interface do app).',
    'Faça o ciclo de verificação das skills antes de entregar: extraia quadros do início, meio e fim, olhe-os e corrija texto cortado, sobreposição, legibilidade e erros; confirme o MP4 com ffprobe.',
    'Ninguém vai responder perguntas: decida sozinho de forma profissional e siga em frente.',
    'Ao terminar, responda APENAS com um resumo de 2 a 4 linhas, em português, do que o vídeo mostra (esse texto vai para o cliente no WhatsApp).',
  ].filter(Boolean);
  if (type?.id === 'broll') lines.push('O vídeo do cliente falando está em ./input — mantenha o áudio original.');
  return lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
}

export function buildPrompt(order, media) {
  const type = findType(order.video_type) || findType('livre');
  const answers = Object.entries(order.answers)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `- ${ANSWER_LABELS[k] || k}: ${labelFor(type, k, v)}`)
    .join('\n');
  const marca = config.marcaDir
    ? `\nIDENTIDADE VISUAL: a pasta ${config.marcaDir} tem logo, cores e fontes do cliente. Use quando combinar com o pedido.\n`
    : '';
  const extra = config.agentExtra ? `\nINSTRUÇÕES FIXAS DO CLIENTE: ${config.agentExtra}\n` : '';
  return `Você é um editor sênior de motion graphics. Este pedido chegou pelo WhatsApp e será feito de forma 100% automática.

PEDIDO #${order.id} — ${type.title}

SKILLS: carregue com a ferramenta Skill, antes de começar, as que servirem para este pedido. Recomendadas: ${type.skills.join(', ')}.
Se precisar de algo que elas não cobrem, use outras skills instaladas (ex.: remotion-video, color-motion, video-delivery-specs).

RESPOSTAS DO CLIENTE:
${answers || '- (sem respostas extras)'}

IDEIA DO CLIENTE (prompt, palavras dele):
"""
${order.idea || '(não informada — use as respostas acima)'}
"""

MATERIAL ENVIADO (pasta ./input):
${materialList(media)}
${marca}${extra}
REGRAS DE ENTREGA:
${deliveryRules(order)}
`;
}

export function buildRevisionPrompt(order, media, fix) {
  const novos = media.filter((m) => m.ts >= (order.delivered_at || '')).map((m) => m.file);
  return `O cliente assistiu ao vídeo do pedido #${order.id} e pediu este ajuste:
"""
${fix}
"""
${novos.length ? `Arquivos novos enviados agora: ${novos.join(', ')}\n` : ''}
Altere o projeto atual para atender o ajuste, mantendo o que não foi pedido para mudar.
Renderize de novo e sobrescreva o mesmo arquivo de saída em ./output. Siga as mesmas regras de entrega e o mesmo ciclo de verificação.
Ao terminar, responda APENAS com 1 a 3 linhas, em português, dizendo o que mudou.`;
}

function describeTool(block) {
  const i = block.input || {};
  switch (block.name) {
    case 'Skill':
      return `📚 Carregou a skill ${i.skill || i.name || ''}`.trim();
    case 'Bash':
      return `💻 ${String(i.description || i.command || '').split('\n')[0].slice(0, 160)}`;
    case 'Write':
      return `📝 Criou ${path.basename(String(i.file_path || ''))}`;
    case 'Edit':
    case 'MultiEdit':
      return `✏️ Editou ${path.basename(String(i.file_path || ''))}`;
    case 'Read':
      return `👀 Leu ${path.basename(String(i.file_path || ''))}`;
    case 'TodoWrite':
      return null;
    default:
      return `🔧 ${block.name}`;
  }
}

function findOutput(dir, since = 0) {
  const out = path.join(dir, 'output');
  if (!fs.existsSync(out)) return null;
  // só vale arquivo criado/atualizado nesta execução
  const files = fs
    .readdirSync(out)
    .map((f) => path.join(out, f))
    .filter((f) => fs.statSync(f).isFile() && fs.statSync(f).mtimeMs >= since - 2000);
  const finals = files.filter((f) => /^final\.(mp4|mov|webm)$/i.test(path.basename(f)));
  if (finals.length) {
    const mp4 = finals.find((f) => f.endsWith('.mp4'));
    const main = mp4 || finals[0];
    const preview = files.find((f) => /^preview\.mp4$/i.test(path.basename(f)));
    return { main, preview: main.endsWith('.mp4') ? null : preview };
  }
  const vids = files.filter((f) => /\.(mp4|mov|webm)$/i.test(f) && !/_whatsapp\.mp4$/i.test(f));
  if (!vids.length) return null;
  vids.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return { main: vids[0], preview: null };
}

const running = new Map(); // orderId -> child

export function cancelRun(orderId) {
  const child = running.get(orderId);
  if (!child) return false;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
  return true;
}

/**
 * Roda o Claude Code. onEvent(text) recebe cada passo (para o painel e progresso no WhatsApp).
 * Resolve com { ok, output, summary, sessionId, usage: [{model,input,output,cacheRead,cacheWrite,cost}], durationMs, turns, error }
 */
export function runAgent({ orderId, prompt, resumeSession, onEvent }) {
  const dir = jobDir(orderId);
  fs.mkdirSync(path.join(dir, 'input'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
  fs.writeFileSync(path.join(dir, resumeSession ? `prompt-ajuste-${Date.now()}.txt` : 'prompt.txt'), prompt);

  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', ALLOWED_TOOLS.join(',')];
  if (config.claudeModel) args.push('--model', config.claudeModel);
  if (config.marcaDir) args.push('--add-dir', config.marcaDir);
  if (resumeSession) args.push('--resume', resumeSession);

  const startedAt = Date.now();
  return new Promise((resolve) => {
    const result = { ok: false, sessionId: resumeSession || null, usage: [], summary: '', output: null };
    let child;
    try {
      child = spawn(config.claudeBin, args, {
        cwd: dir,
        windowsHide: true,
        shell: process.platform === 'win32', // resolve claude.cmd no Windows (argumentos são fixos e seguros)
        env: { ...process.env, CI: '1' },
      });
    } catch (e) {
      return resolve({ ...result, error: `Não consegui iniciar o Claude Code: ${e.message}` });
    }
    running.set(orderId, child);
    const log = fs.createWriteStream(path.join(dir, 'agente.log'), { flags: 'a' });
    let buf = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      cancelRun(orderId);
    }, config.jobTimeoutMin * 60_000);

    const handle = (line) => {
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        return;
      }
      if (j.type === 'system' && j.subtype === 'init') {
        result.sessionId = j.session_id;
        onEvent?.(`🤖 Agente iniciado (modelo ${j.model})`);
      } else if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
        for (const b of j.message.content) {
          if (b.type === 'tool_use') {
            const d = describeTool(b);
            if (d) onEvent?.(d);
          } else if (b.type === 'text' && b.text?.trim()) {
            onEvent?.(`💭 ${b.text.trim().slice(0, 400)}`);
          }
        }
      } else if (j.type === 'result') {
        result.sessionId = j.session_id || result.sessionId;
        result.summary = (j.result || '').trim();
        result.durationMs = j.duration_ms;
        result.turns = j.num_turns;
        result.isError = !!j.is_error;
        const mu = j.modelUsage || {};
        result.usage = Object.entries(mu).map(([model, u]) => ({
          model,
          input: u.inputTokens || 0,
          output: u.outputTokens || 0,
          cacheRead: u.cacheReadInputTokens || 0,
          cacheWrite: u.cacheCreationInputTokens || 0,
          cost: u.costUSD || 0,
        }));
        if (!result.usage.length && j.usage) {
          result.usage = [{
            model: 'desconhecido',
            input: j.usage.input_tokens || 0,
            output: j.usage.output_tokens || 0,
            cacheRead: j.usage.cache_read_input_tokens || 0,
            cacheWrite: j.usage.cache_creation_input_tokens || 0,
            cost: j.total_cost_usd || 0,
          }];
        }
        // distribui duração/turnos para o primeiro modelo (o principal)
        if (result.usage[0]) Object.assign(result.usage[0], { durationMs: j.duration_ms, turns: j.num_turns });
      }
    };

    child.stdout.on('data', (d) => {
      log.write(d);
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handle(line);
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      log.write(d);
    });
    child.on('error', (e) => {
      stderr += String(e);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);

    child.on('close', (code) => {
      clearTimeout(timer);
      running.delete(orderId);
      if (buf.trim()) handle(buf.trim());
      log.end();
      result.output = findOutput(dir, startedAt);
      result.ok = !!result.output && !result.isError && !timedOut;
      if (!result.ok) {
        result.error = timedOut
          ? `Tempo limite de ${config.jobTimeoutMin} min atingido.`
          : !result.output
            ? `O agente terminou sem gerar o vídeo (código ${code}). ${stderr.slice(-400) || result.summary.slice(0, 400)}`
            : `O agente terminou com erro: ${result.summary.slice(0, 400)}`;
      }
      resolve(result);
    });
  });
}
