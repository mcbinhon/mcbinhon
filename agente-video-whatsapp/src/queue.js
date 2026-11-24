// Fila de produção: um vídeo por vez (renderizar é pesado), entrega no WhatsApp.
import fs from 'node:fs';
import path from 'node:path';
import { buildPrompt, buildRevisionPrompt, cancelRun, jobDir, runAgent } from './agent.js';
import { findType } from './catalog.js';
import { config } from './config.js';
import { Events, Media, Orders, Usage, now } from './db.js';
import { evolution } from './evolution.js';
import { mimeOf, prepareForWhatsApp } from './media.js';
import { say } from './notify.js';

const queue = []; // { orderId, kind: 'gerar' | 'ajuste' }
let current = null;
const PROGRESS_EVERY_MS = 4 * 60_000;

export const queueInfo = () => ({ current, waiting: queue.map((j) => j.orderId) });
export const positionOf = (orderId) => queue.findIndex((j) => j.orderId === orderId) + 1;

export function enqueue(orderId, kind = 'gerar') {
  if (current?.orderId === orderId || queue.some((j) => j.orderId === orderId)) return positionOf(orderId);
  queue.push({ orderId, kind });
  Orders.update(orderId, { status: 'na_fila' });
  Events.add(orderId, 'sistema', kind === 'ajuste' ? 'Ajuste entrou na fila' : 'Pedido entrou na fila');
  setImmediate(work);
  return positionOf(orderId) + (current ? 1 : 0);
}

export function removeFromQueue(orderId) {
  const i = queue.findIndex((j) => j.orderId === orderId);
  if (i >= 0) queue.splice(i, 1);
  if (current?.orderId === orderId) cancelRun(orderId);
}

/** Ao reiniciar o programa: devolve à fila o que estava pendente. */
export function restoreQueue() {
  for (const o of Orders.byStatus('gerando', 'na_fila')) {
    Events.add(o.id, 'sistema', 'Programa reiniciado — pedido voltou para a fila');
    enqueue(o.id, o.pending_fix ? 'ajuste' : 'gerar');
  }
}

async function work() {
  if (current || !queue.length) return;
  current = queue.shift();
  try {
    await processJob(current);
  } catch (e) {
    console.error('[fila] erro inesperado', e);
    Orders.update(current.orderId, { status: 'falhou', error: String(e.message || e) });
    Events.add(current.orderId, 'erro', `Erro inesperado: ${e.message || e}`);
  } finally {
    current = null;
    setImmediate(work);
  }
}

async function processJob({ orderId, kind }) {
  let order = Orders.get(orderId);
  if (!order || order.status === 'cancelado') return;
  const isFix = kind === 'ajuste';
  const media = Media.forOrder(orderId);
  order = Orders.update(orderId, { status: 'gerando', started_at: isFix ? order.started_at : now(), error: null });
  const type = findType(order.video_type);

  await say(
    order,
    isFix
      ? `🔁 Fazendo o ajuste do pedido *#${orderId}*... te aviso quando ficar pronto.`
      : `🎬 Comecei o pedido *#${orderId}* (${type?.title || 'vídeo'}). Isso leva alguns minutos — te mando o vídeo aqui quando ficar pronto.`,
  );

  let lastStep = '';
  let lastPing = Date.now();
  const onEvent = (text) => {
    Events.add(orderId, 'agente', text);
    if (!text.startsWith('💭')) lastStep = text;
    if (Date.now() - lastPing > PROGRESS_EVERY_MS) {
      lastPing = Date.now();
      say(Orders.get(orderId), `⏳ Ainda trabalhando no *#${orderId}*…${lastStep ? `\n_${lastStep.slice(0, 120)}_` : ''}`);
    }
  };

  const prompt = isFix ? buildRevisionPrompt(order, media, order.pending_fix) : buildPrompt(order, media);
  let result = await runAgent({ orderId, prompt, resumeSession: isFix ? order.session_id : null, onEvent });

  // se a sessão anterior não puder ser retomada, refaz do zero já com o ajuste
  if (isFix && !result.ok && !/Tempo limite/.test(result.error || '') && Orders.get(orderId).status !== 'cancelado') {
    Events.add(orderId, 'sistema', 'Não deu para continuar a sessão anterior — refazendo com o ajuste incluído');
    saveUsage(orderId, order.revisions, result);
    const full = `${buildPrompt(order, media)}\nAJUSTE PEDIDO PELO CLIENTE DEPOIS DA PRIMEIRA VERSÃO:\n"""\n${order.pending_fix}\n"""\n`;
    result = await runAgent({ orderId, prompt: full, onEvent });
  }

  saveUsage(orderId, isFix ? order.revisions + 1 : order.revisions, result);
  if (result.sessionId) Orders.update(orderId, { session_id: result.sessionId });

  if (Orders.get(orderId).status === 'cancelado') {
    Events.add(orderId, 'sistema', 'Execução interrompida (pedido cancelado)');
    return;
  }

  if (!result.ok) {
    Orders.update(orderId, { status: 'falhou', error: result.error, step: 'fim' });
    Events.add(orderId, 'erro', result.error);
    await say(
      Orders.get(orderId),
      `❌ Não consegui concluir o pedido *#${orderId}*.\nMotivo: ${String(result.error).slice(0, 300)}\n\nDigite *tentar* para tentar de novo ou *edição* para um novo pedido.`,
    );
    return;
  }

  await deliver(orderId, result, isFix);
}

function saveUsage(orderId, run, result) {
  for (const u of result.usage || []) Usage.add(orderId, run, u);
  const tot = (result.usage || []).reduce((a, u) => a + u.input + u.output + u.cacheRead + u.cacheWrite, 0);
  const cost = (result.usage || []).reduce((a, u) => a + u.cost, 0);
  if (tot) Events.add(orderId, 'sistema', `Tokens desta execução: ${tot.toLocaleString('pt-BR')} (US$ ${cost.toFixed(4)})`);
}

async function sendFile(order, file, caption) {
  const prep = await prepareForWhatsApp(file, config.maxVideoMB);
  const size = fs.statSync(prep.file).size;
  if (size > 95 * 1024 * 1024) throw new Error(`arquivo grande demais para o WhatsApp (${(size / 1048576).toFixed(0)} MB)`);
  const base64 = fs.readFileSync(prep.file).toString('base64');
  await evolution.sendMedia(order.reply_to, {
    mediatype: prep.as,
    mimetype: prep.as === 'video' ? 'video/mp4' : mimeOf(prep.file),
    fileName: `pedido-${order.id}${path.extname(prep.file)}`,
    caption,
    base64,
  });
  Events.add(order.id, 'saida', `📎 ${prep.as === 'video' ? 'Vídeo' : 'Arquivo'} enviado: ${path.basename(prep.file)} (${(size / 1048576).toFixed(1)} MB)${prep.note ? ` — ${prep.note}` : ''}`);
}

async function deliver(orderId, result, isFix) {
  let order = Orders.get(orderId);
  const dir = jobDir(orderId);
  const rel = path.relative(dir, result.output.main).replaceAll('\\', '/');
  order = Orders.update(orderId, {
    status: 'entregue',
    step: 'ajuste',
    output_file: rel,
    summary: result.summary.slice(0, 1500),
    delivered_at: now(),
    pending_fix: null,
    revisions: isFix ? order.revisions + 1 : order.revisions,
  });
  const caption = `✅ ${isFix ? 'Ajuste do pedido' : 'Pedido'} *#${orderId}* pronto!\n\n${result.summary.slice(0, 700)}`;
  try {
    await sendFile(order, result.output.main, caption);
    if (result.output.preview) await sendFile(order, result.output.preview, '👀 Prévia (o arquivo acima tem fundo transparente)');
  } catch (e) {
    Events.add(orderId, 'erro', `Vídeo pronto mas o envio falhou: ${e.message}`);
    await say(order, `⚠️ O vídeo *#${orderId}* ficou pronto, mas não consegui enviar pelo WhatsApp (${e.message}). Ele está no painel do computador.`);
  }
  const left = Math.max(0, config.maxAjustes - order.revisions);
  await say(
    order,
    left > 0
      ? `Gostou? Responda:\n*ok* — para finalizar\nou escreva o que quer *ajustar* (ex.: _"deixa o texto maior e o fundo azul"_). Você ainda tem ${left} ajuste(s).`
      : 'Esse pedido chegou ao limite de ajustes. Responda *ok* para finalizar ou *edição* para um novo pedido.',
  );
}
