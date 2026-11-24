// Roteiro da conversa no WhatsApp: "edição" → material → tipo → perguntas → ideia → confirmação → fila.
import { jobDir } from './agent.js';
import { ANSWER_LABELS, CATALOG, findType, labelFor, menuText, questionText, questionsFor } from './catalog.js';
import { config } from './config.js';
import { Events, Media, Orders, db } from './db.js';
import { evolution } from './evolution.js';
import { saveIncoming } from './media.js';
import { say, sayRaw } from './notify.js';
import { enqueue, positionOf, queueInfo, removeFromQueue } from './queue.js';

// ---------- utilidades ----------
export const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[!.,;:?*_~]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const YES = ['1', 'sim', 's', 'gerar', 'pode', 'pode gerar', 'confirmo', 'confirmar', 'ok', 'isso', 'manda', 'bora'];
const NO = ['2', 'nao', 'n', 'corrigir', 'mudar', 'alterar'];
const DONE = ['ok', 'finalizar', 'finaliza', 'obrigado', 'obrigada', 'valeu', 'perfeito', 'show', 'top', 'aprovado', 'gostei', 'otimo', 'fechou', '👍'];
const READY = ['pronto', 'pronta', 'pular', 'so isso', 'e isso', 'terminei', 'acabou', 'nao tenho', 'sem foto', 'sem fotos', 'nenhum', 'proximo'];

const minutesSince = (ts) => (Date.now() - new Date(ts.replace(' ', 'T')).getTime()) / 60_000;

/** Variações do número brasileiro com e sem o 9º dígito. */
function variants(d) {
  const s = new Set([d]);
  if (d.startsWith('55')) {
    if (d.length === 13 && d[4] === '9') s.add(d.slice(0, 4) + d.slice(5));
    if (d.length === 12) s.add(d.slice(0, 4) + '9' + d.slice(4));
  }
  return s;
}

/** Retorna o número autorizado (forma do .env) ou null. */
export function authorized(phoneDigits) {
  if (!phoneDigits) return null;
  const v = variants(phoneDigits);
  return config.allowedNumbers.find((a) => [...variants(a)].some((x) => v.has(x))) || null;
}

// ---------- leitura do webhook da Evolution ----------
const MEDIA_KINDS = { imageMessage: 'imagem', videoMessage: 'video', audioMessage: 'audio', documentMessage: 'documento', ptvMessage: 'video' };

export function parseInbound(body) {
  const event = String(body?.event || '').toLowerCase().replace('_', '.');
  if (event !== 'messages.upsert') return null;
  const d = Array.isArray(body.data) ? body.data[0] : body.data;
  if (!d?.key || d.key.fromMe) return null;
  const jid = d.key.remoteJid || '';
  if (/@g\.us$|@broadcast$|@newsletter$/.test(jid)) return null;

  const jids = [d.key.remoteJid, d.key.remoteJidAlt, d.key.senderPn, d.remoteJidAlt].filter(Boolean);
  const pn = jids.find((j) => j.endsWith('@s.whatsapp.net')) || jids.find((j) => !j.includes('@'));
  const phone = pn ? pn.split('@')[0].split(':')[0].replace(/\D/g, '') : '';

  let m = d.message || {};
  m = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message || m;
  if (m.documentWithCaptionMessage?.message) m = { ...m, ...m.documentWithCaptionMessage.message };

  const mediaKey = Object.keys(MEDIA_KINDS).find((k) => m[k]);
  const inner = mediaKey ? m[mediaKey] : null;
  const text = m.conversation || m.extendedTextMessage?.text || inner?.caption || '';
  return {
    id: d.key.id,
    phone,
    replyTo: pn || jid,
    name: d.pushName || '',
    text: String(text),
    media: inner
      ? {
          kind: MEDIA_KINDS[mediaKey],
          mimetype: inner.mimetype || '',
          fileName: inner.fileName || inner.title || '',
          caption: inner.caption || '',
          base64: d.message?.base64 || m.base64 || null,
        }
      : null,
    raw: d,
  };
}

// ---------- processamento em ordem, por número ----------
const chains = new Map();
const seen = new Set();

export function handleInbound(msg) {
  if (!msg) return;
  if (seen.has(msg.id)) return;
  seen.add(msg.id);
  if (seen.size > 2000) seen.delete(seen.values().next().value);

  const allowed = authorized(msg.phone);
  if (!allowed) {
    console.log(`[ignorado] mensagem de número não autorizado (${msg.phone ? msg.phone.slice(0, 4) + '…' : 'sem número'})`);
    return;
  }
  msg.phone = allowed;
  const prev = chains.get(allowed) || Promise.resolve();
  const next = prev.then(() => onMessage(msg)).catch((e) => console.error('[conversa] erro', e));
  chains.set(allowed, next);
  return next;
}

// confirmações de mídia agrupadas (evita 10 respostas para 10 fotos)
const ackTimers = new Map();
function ackMedia(orderId) {
  clearTimeout(ackTimers.get(orderId));
  ackTimers.set(
    orderId,
    setTimeout(async () => {
      ackTimers.delete(orderId);
      const o = Orders.get(orderId);
      if (!o) return;
      const media = Media.forOrder(orderId);
      const count = (k) => media.filter((m) => m.kind === k).length;
      const parts = [['imagem', 'foto(s)'], ['video', 'vídeo(s)'], ['audio', 'áudio(s)'], ['documento', 'documento(s)']]
        .filter(([k]) => count(k))
        .map(([k, l]) => `${count(k)} ${l}`);
      let tail = '';
      if (o.status === 'coletando' && o.step === 'media') tail = '\nMande mais ou digite *pronto* para continuar.';
      else if (o.status === 'entregue') tail = '\nAgora escreva o *ajuste* que quer fazer.';
      else if (o.status === 'coletando') tail = '\n(continue respondendo a pergunta acima)';
      await say(o, `📥 Recebido! No pedido *#${orderId}*: ${parts.join(', ')}.${tail}`);
    }, 3500),
  );
}

async function storeMedia(order, msg) {
  let { base64, mimetype, fileName } = msg.media;
  if (!base64) {
    try {
      const r = await evolution.getMediaBase64(msg.raw);
      base64 = r.base64;
      mimetype = mimetype || r.mimetype;
      fileName = fileName || r.fileName;
    } catch (e) {
      Events.add(order.id, 'erro', `Não consegui baixar a mídia: ${e.message}`);
      await say(order, '⚠️ Não consegui baixar esse arquivo. Pode mandar de novo?');
      return false;
    }
  }
  const seq = Media.forOrder(order.id).length + 1;
  const saved = saveIncoming(jobDir(order.id), seq, { kind: msg.media.kind, mimetype, base64, fileName });
  Media.add(order.id, { kind: msg.media.kind, mimetype, file: saved.rel, size: saved.size, caption: msg.media.caption });
  Events.add(order.id, 'entrada', `📎 ${msg.media.kind}: ${saved.rel}${msg.media.caption ? ` — "${msg.media.caption}"` : ''}`);
  ackMedia(order.id);
  return true;
}

// ---------- textos ----------
const help = () =>
  `👋 Sou o *Agente de Vídeo*.\n\n` +
  `*${config.triggerWord}* — começar um vídeo novo\n` +
  `*status* — ver seus pedidos\n` +
  `*cancelar* — cancelar o pedido atual\n` +
  `*menu* — trocar o tipo de vídeo (durante um pedido)\n` +
  `*voltar* — voltar uma pergunta`;

const welcome = (o) =>
  `🎬 *Novo pedido #${o.id}*\n\n` +
  `1️⃣ Mande agora as *fotos, vídeos, áudios ou logo* que devem entrar no vídeo (pode mandar vários).\n` +
  `2️⃣ Quando terminar, digite *pronto*.\n\n` +
  `_Não tem material? Digite *pronto* direto que eu crio do zero._`;

function summaryText(order) {
  const type = findType(order.video_type);
  const media = Media.forOrder(order.id);
  const ans = Object.entries(order.answers)
    .filter(([k, v]) => v !== '' && v != null && !k.startsWith('_'))
    .map(([k, v]) => `• ${ANSWER_LABELS[k] || k}: ${labelFor(type, k, v)}`)
    .join('\n');
  return (
    `📋 *Resumo do pedido #${order.id}*\n\n` +
    `🎞️ Tipo: *${type?.title}*\n` +
    `📎 Material: ${media.length ? `${media.length} arquivo(s)` : 'nenhum (criar do zero)'}\n` +
    (ans ? `${ans}\n` : '') +
    `💡 Ideia: ${order.idea || '—'}\n\n` +
    `*1* — ✅ Gerar o vídeo\n*2* — ✏️ Corrigir (escolher de novo)\n\n_Ou escreva algo para acrescentar à ideia._`
  );
}

async function askQuestion(order, idx) {
  const type = findType(order.video_type);
  const qs = questionsFor(type, Media.forOrder(order.id));
  if (idx >= qs.length) {
    order = Orders.update(order.id, { step: 'ideia' });
    return say(
      order,
      `💡 *Agora descreva a sua ideia* com suas palavras (o prompt).\n\n` +
        `Quanto mais detalhe, melhor: textos que devem aparecer, ordem das cenas, clima, chamada final, contato...\n\n` +
        `_Digite *pular* se as respostas já bastam._`,
    );
  }
  Orders.update(order.id, { step: `q:${idx}` });
  return say(order, questionText(qs[idx], idx, qs.length));
}

function missingRequirement(type, media) {
  for (const req of type.requires || []) {
    if (!media.some((m) => m.kind === req)) return req;
  }
  return null;
}

async function chooseType(order, type) {
  order = Orders.update(order.id, { video_type: type.id });
  Events.add(order.id, 'sistema', `Tipo escolhido: ${type.title}`);
  const miss = missingRequirement(type, Media.forOrder(order.id));
  if (miss) {
    Orders.update(order.id, { step: 'media' });
    const what = { imagem: 'pelo menos uma *foto*', video: 'um *vídeo* (você falando para a câmera)' }[miss] || `um arquivo de ${miss}`;
    return say(order, `📎 *${type.title}* precisa de ${what}. Mande agora e depois digite *pronto*.\n_(ou *menu* para escolher outro tipo)_`);
  }
  return askQuestion(order, 0);
}

// ---------- máquina de estados ----------
async function onMessage(msg) {
  if (!msg.media && !msg.text.trim()) return; // figurinha, reação, localização...
  const t = norm(msg.text);
  let order = Orders.activeFor(msg.phone);

  // expira conversas paradas
  if (order?.status === 'coletando' && minutesSince(order.updated_at) > config.conversaExpiraMin) {
    Orders.update(order.id, { status: 'expirado', step: 'fim' });
    Events.add(order.id, 'sistema', 'Conversa expirou por falta de resposta');
    order = null;
  }
  if (order?.status === 'entregue' && minutesSince(order.delivered_at || order.updated_at) > 48 * 60) {
    Orders.update(order.id, { status: 'finalizado', step: 'fim' });
    order = null;
  }

  if (order && !msg.media && msg.text) Events.add(order.id, 'entrada', msg.text);

  // ----- comandos globais -----
  if (!msg.media && t === norm(config.triggerWord)) {
    if (order?.status === 'coletando') {
      Orders.update(order.id, { status: 'cancelado', step: 'fim' });
      Events.add(order.id, 'sistema', 'Substituído por um novo pedido');
    } else if (order?.status === 'entregue') {
      Orders.update(order.id, { status: 'finalizado', step: 'fim' });
    }
    const o = Orders.create({ phone: msg.phone, replyTo: msg.replyTo, name: msg.name });
    Events.add(o.id, 'entrada', msg.text);
    Events.add(o.id, 'sistema', 'Pedido iniciado');
    return say(o, welcome(o));
  }

  if (!msg.media && ['cancelar', 'cancela', 'parar', 'para', 'desistir'].includes(t)) {
    if (!order) return sayRaw(msg.replyTo, 'Não há pedido em andamento. Digite *' + config.triggerWord + '* para começar.');
    removeFromQueue(order.id);
    Orders.update(order.id, { status: 'cancelado', step: 'fim' });
    Events.add(order.id, 'sistema', 'Cancelado pelo cliente');
    return say(order, `🛑 Pedido *#${order.id}* cancelado. Digite *${config.triggerWord}* para começar outro.`);
  }

  if (!msg.media && t === 'status') {
    const rows = db
      .prepare("SELECT id, status, video_type, created_at FROM orders WHERE phone = ? ORDER BY id DESC LIMIT 5")
      .all(msg.phone);
    const label = { coletando: '📝 em conversa', na_fila: '⏳ na fila', gerando: '🎬 gerando', entregue: '✅ entregue', finalizado: '🏁 finalizado', falhou: '❌ falhou', cancelado: '🛑 cancelado', expirado: '⌛ expirou' };
    const q = queueInfo();
    const text = rows.length
      ? '📊 *Seus últimos pedidos*\n\n' +
        rows.map((r) => `*#${r.id}* ${findType(r.video_type)?.title || '—'} — ${label[r.status] || r.status}${r.status === 'na_fila' ? ` (posição ${positionOf(r.id) + (q.current ? 1 : 0)})` : ''}\n_${r.created_at}_`).join('\n\n')
      : 'Você ainda não fez pedidos.';
    return order ? say(order, text) : sayRaw(msg.replyTo, text);
  }

  if (!msg.media && ['ajuda', 'help', 'oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', '?'].includes(t) && (!order || order.status !== 'coletando')) {
    return order ? say(order, help()) : sayRaw(msg.replyTo, help());
  }

  // ----- sem pedido aberto -----
  if (!order) {
    if (!msg.media && t === 'tentar') {
      const last = db.prepare("SELECT id FROM orders WHERE phone = ? ORDER BY id DESC LIMIT 1").get(msg.phone);
      const o = last && Orders.get(last.id);
      if (o?.status === 'falhou') {
        Events.add(o.id, 'entrada', msg.text);
        const pos = enqueue(o.id, o.pending_fix ? 'ajuste' : 'gerar');
        return say(o, `🔁 Tentando de novo o pedido *#${o.id}* (posição ${pos} na fila).`);
      }
    }
    return sayRaw(msg.replyTo, `Para pedir um vídeo, digite *${config.triggerWord}*.\n\n` + help());
  }

  // ----- pedido em produção -----
  if (order.status === 'na_fila' || order.status === 'gerando') {
    if (msg.media) await storeMedia(order, msg);
    const pos = positionOf(order.id);
    return say(
      order,
      order.status === 'gerando'
        ? `🎬 O pedido *#${order.id}* está sendo produzido agora. Te mando assim que ficar pronto.\n_Digite *cancelar* para cancelar._`
        : `⏳ O pedido *#${order.id}* está na fila (posição ${pos + (queueInfo().current ? 1 : 0)}).`,
    );
  }

  // ----- entregue: ok ou ajuste -----
  if (order.status === 'entregue') {
    if (msg.media) return storeMedia(order, msg);
    if (order.step === 'confirmar_ajuste') {
      if (YES.includes(t)) {
        const pos = enqueue(order.id, 'ajuste');
        return say(order, `👍 Ajuste confirmado! Posição na fila: ${pos}.`);
      }
      if (NO.includes(t)) {
        Orders.update(order.id, { step: 'ajuste', pending_fix: null });
        return say(order, 'Ok! Escreva de novo o que quer ajustar (ou *ok* para finalizar).');
      }
      order = Orders.update(order.id, { pending_fix: `${order.pending_fix}\n${msg.text}` });
      return say(order, `📝 Acrescentei. Ajuste completo:\n_${order.pending_fix}_\n\n*1* — Confirmar  |  *2* — Escrever de novo`);
    }
    if (DONE.includes(t)) {
      Orders.update(order.id, { status: 'finalizado', step: 'fim' });
      Events.add(order.id, 'sistema', 'Finalizado pelo cliente');
      return say(order, `🙌 Pedido *#${order.id}* finalizado! Quando quiser outro, digite *${config.triggerWord}*.`);
    }
    if (order.revisions >= config.maxAjustes) {
      return say(order, `Esse pedido já usou os ${config.maxAjustes} ajustes. Digite *ok* para finalizar ou *${config.triggerWord}* para um novo pedido.`);
    }
    if (t.length < 3) return say(order, 'Escreva o que quer ajustar no vídeo, ou *ok* para finalizar.');
    order = Orders.update(order.id, { step: 'confirmar_ajuste', pending_fix: msg.text });
    return say(order, `🔁 Vou ajustar assim:\n_${msg.text}_\n\n*1* — Confirmar  |  *2* — Escrever de novo\n_(ou mande mais detalhes)_`);
  }

  // ----- coletando (conversa guiada) -----
  if (msg.media) return storeMedia(order, msg);

  if (t === 'menu' && order.step !== 'media') {
    order = Orders.update(order.id, { step: 'tipo' });
    return say(order, menuText());
  }

  const step = order.step;

  if (step === 'media') {
    if (READY.includes(t) || t === 'menu') {
      const type = t !== 'menu' && order.video_type && findType(order.video_type);
      if (type) return chooseType(order, type);
      order = Orders.update(order.id, { step: 'tipo', video_type: null });
      return say(order, menuText());
    }
    const a = order.answers;
    a.observacoes = [a.observacoes, msg.text].filter(Boolean).join(' | ');
    Orders.update(order.id, { answers: a });
    return say(order, '📝 Anotei. Continue mandando o material ou digite *pronto*.');
  }

  if (step === 'tipo') {
    const n = parseInt(t, 10);
    const type = Number.isInteger(n) && CATALOG[n - 1] ? CATALOG[n - 1] : CATALOG.find((c) => norm(c.title).startsWith(t) && t.length > 3);
    if (!type) return say(order, '🤔 Não entendi. Responda só com o *número* do tipo:\n\n' + menuText());
    const keep = order.answers.observacoes ? { observacoes: order.answers.observacoes } : {};
    order = Orders.update(order.id, { answers: keep });
    return chooseType(order, type);
  }

  if (step.startsWith('q:')) {
    const idx = Number(step.slice(2));
    const type = findType(order.video_type);
    const qs = questionsFor(type, Media.forOrder(order.id));
    const q = qs[idx];
    if (t === 'voltar') return askQuestion(order, Math.max(0, idx - 1));
    if (!q) return askQuestion(order, qs.length);

    let value;
    if (t === 'pular' || t === '') {
      if (!q.optional) return say(order, '✋ Essa resposta é necessária para o vídeo ficar certo:\n\n' + questionText(q, idx, qs.length));
      value = q.default ?? '';
    } else if (q.options) {
      const n = parseInt(t, 10);
      const byNum = Number.isInteger(n) && String(n) === t ? q.options[n - 1] : null;
      const byText = q.options.find((o) => norm(o.label).includes(t) || t.includes(norm(o.value)));
      if (byNum || byText) value = (byNum || byText).value;
      else if (q.key === 'duracao' && /\d/.test(t)) value = t.match(/\d+/)[0];
      else return say(order, '🤔 Responda com o *número* da opção:\n\n' + questionText(q, idx, qs.length));
    } else {
      value = msg.text.trim();
    }
    const a = order.answers;
    a[q.key] = value;
    order = Orders.update(order.id, { answers: a });
    return askQuestion(order, idx + 1);
  }

  if (step === 'ideia') {
    if (t !== 'pular' && t.length < 4) return say(order, 'Escreva um pouco mais sobre a ideia 🙂 (ou *pular*).');
    order = Orders.update(order.id, { idea: t === 'pular' ? '' : msg.text.trim(), step: 'confirmar' });
    return say(order, summaryText(order));
  }

  if (step === 'confirmar') {
    if (YES.includes(t)) {
      const pos = enqueue(order.id, 'gerar');
      return say(
        Orders.get(order.id),
        `🚀 Pedido *#${order.id}* confirmado!${pos > 1 ? ` Posição na fila: ${pos}.` : ''}\nVou te avisando por aqui.`,
      );
    }
    if (NO.includes(t)) {
      order = Orders.update(order.id, { step: 'tipo', idea: null });
      return say(order, '✏️ Vamos corrigir. O material enviado continua guardado.\n\n' + menuText());
    }
    order = Orders.update(order.id, { idea: [order.idea, msg.text.trim()].filter(Boolean).join('\n') });
    return say(order, '📝 Acrescentei à ideia.\n\n' + summaryText(order));
  }

  return say(order, help());
}
