// Servidor HTTP sem dependências: webhook da Evolution + API e páginas do painel.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { jobDir } from './agent.js';
import { ANSWER_LABELS, CATALOG, findType, labelFor } from './catalog.js';
import { ROOT, config } from './config.js';
import { handleInbound, parseInbound } from './conversation.js';
import { Events, Media, Orders, Usage, now, statusCounts } from './db.js';
import { evolution, setWhatsappState, whatsappState } from './evolution.js';
import { enqueue, queueInfo, removeFromQueue } from './queue.js';

const PUBLIC = path.join(ROOT, 'public');
let lastQr = null;

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function readBody(req, limit = 150 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('corpo grande demais'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function dashboardAllowed(req, url) {
  if (isLocal(req)) return true;
  if (!config.dashboardToken) return false;
  const tok = url.searchParams.get('token') || req.headers['x-token'] || (req.headers.cookie || '').match(/painel=([^;]+)/)?.[1];
  return tok === config.dashboardToken;
}

function streamFile(req, res, file) {
  if (!fs.existsSync(file)) return send(res, 404, { erro: 'arquivo não encontrado' });
  const stat = fs.statSync(file);
  const types = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8' };
  const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

/** Garante que o caminho fica dentro da pasta do pedido. */
function inside(base, rel) {
  const p = path.resolve(base, rel);
  return p.startsWith(path.resolve(base) + path.sep) ? p : null;
}

export function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      // ---------- webhook da Evolution ----------
      if (req.method === 'POST' && p.startsWith('/webhook/')) {
        if (decodeURIComponent(p.slice(9)) !== config.webhookSecret) return send(res, 403, { erro: 'segredo inválido' });
        const raw = await readBody(req);
        send(res, 200, { ok: true });
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return;
        }
        const ev = String(body.event || '').toLowerCase();
        if (ev === 'connection.update') {
          setWhatsappState(body.data?.state);
          if (body.data?.state === 'open') lastQr = null;
        } else if (ev === 'qrcode.updated') {
          lastQr = body.data?.qrcode?.base64 || lastQr;
          setWhatsappState('aguardando_qr');
        } else {
          handleInbound(parseInbound(body));
        }
        return;
      }

      // ---------- painel (somente local ou com token) ----------
      if (!dashboardAllowed(req, url)) return send(res, 403, 'Painel disponível só neste computador (ou configure DASHBOARD_TOKEN).', 'text/plain; charset=utf-8');
      if (url.searchParams.get('token')) res.setHeader('Set-Cookie', `painel=${url.searchParams.get('token')}; Path=/; HttpOnly; SameSite=Strict`);

      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && p.startsWith('/vendor/')) {
        const f = inside(path.join(PUBLIC, 'vendor'), p.slice(8));
        if (!f || !fs.existsSync(f)) return send(res, 404, 'não encontrado', 'text/plain');
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=86400' });
        return fs.createReadStream(f).pipe(res);
      }

      if (req.method === 'GET' && p === '/api/resumo') {
        const today = now().slice(0, 10);
        const month = today.slice(0, 7);
        return send(res, 200, {
          whatsapp: whatsappState(),
          numeros: config.allowedNumbers.map((n) => n.slice(0, 4) + '•••' + n.slice(-4)),
          fila: queueInfo(),
          hoje: { status: statusCounts(today), ...Usage.totals(today) },
          mes: { status: statusCounts(month), ...Usage.totals(month) },
          ano: Usage.totals(today.slice(0, 4)),
          usdBrl: config.usdBrl,
          tipos: CATALOG.map((c) => ({ id: c.id, title: c.title })),
        });
      }

      if (req.method === 'GET' && p === '/api/pedidos') {
        const rows = Orders.list({ status: url.searchParams.get('status') || '', q: url.searchParams.get('q') || '' });
        return send(res, 200, rows.map((r) => ({ ...r, tipo: findType(r.video_type)?.title || '—' })));
      }

      let m = p.match(/^\/api\/pedidos\/(\d+)$/);
      if (req.method === 'GET' && m) {
        const o = Orders.get(Number(m[1]));
        if (!o) return send(res, 404, { erro: 'não encontrado' });
        return send(res, 200, {
          ...o,
          tipo: findType(o.video_type)?.title || '—',
          respostas: Object.entries(o.answers)
            .filter(([, v]) => v !== '' && v != null)
            .map(([k, v]) => [ANSWER_LABELS[k] || k, findType(o.video_type) ? labelFor(findType(o.video_type), k, v) : v]),
          skills: findType(o.video_type)?.skills || [],
          eventos: Events.forOrder(o.id),
          midias: Media.forOrder(o.id),
          uso: Usage.forOrder(o.id),
          temPrompt: fs.existsSync(path.join(jobDir(o.id), 'prompt.txt')),
        });
      }

      m = p.match(/^\/api\/pedidos\/(\d+)\/arquivo$/);
      if (req.method === 'GET' && m) {
        const base = jobDir(Number(m[1]));
        const file = inside(base, url.searchParams.get('p') || '');
        if (!file) return send(res, 400, { erro: 'caminho inválido' });
        return streamFile(req, res, file);
      }

      m = p.match(/^\/api\/pedidos\/(\d+)\/(cancelar|refazer|reenviar)$/);
      if (req.method === 'POST' && m) {
        const id = Number(m[1]);
        const o = Orders.get(id);
        if (!o) return send(res, 404, { erro: 'não encontrado' });
        if (m[2] === 'cancelar') {
          removeFromQueue(id);
          Orders.update(id, { status: 'cancelado', step: 'fim' });
          Events.add(id, 'sistema', 'Cancelado pelo painel');
        } else if (m[2] === 'refazer') {
          Events.add(id, 'sistema', 'Reenviado para a fila pelo painel');
          enqueue(id, o.pending_fix ? 'ajuste' : 'gerar');
        } else if (m[2] === 'reenviar') {
          if (!o.output_file) return send(res, 400, { erro: 'pedido sem vídeo' });
          const file = path.join(jobDir(id), o.output_file);
          const b64 = fs.readFileSync(file).toString('base64');
          await evolution.sendMedia(o.reply_to, {
            mediatype: o.output_file.endsWith('.mp4') && fs.statSync(file).size < config.maxVideoMB * 1048576 ? 'video' : 'document',
            mimetype: o.output_file.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream',
            fileName: `pedido-${id}${path.extname(file)}`,
            caption: `📎 Pedido #${id} (reenviado)`,
            base64: b64,
          });
          Events.add(id, 'saida', 'Vídeo reenviado pelo painel');
        }
        return send(res, 200, { ok: true });
      }

      if (req.method === 'GET' && p === '/api/tokens') {
        const g = url.searchParams.get('agrupar') || 'dia';
        return send(res, 200, { agrupar: g, usdBrl: config.usdBrl, ...Usage.report(g, url.searchParams.get('de'), url.searchParams.get('ate')) });
      }

      if (req.method === 'GET' && p === '/api/tokens.csv') {
        const g = url.searchParams.get('agrupar') || 'dia';
        const { rows } = Usage.report(g, url.searchParams.get('de'), url.searchParams.get('ate'));
        const csv = ['periodo;pedidos;execucoes;input;output;cache_leitura;cache_escrita;total;custo_usd;custo_brl']
          .concat(rows.map((r) => [r.periodo, r.pedidos, r.execucoes, r.input, r.output, r.cache_read, r.cache_write, r.total, r.cost_usd.toFixed(4).replace('.', ','), (r.cost_usd * config.usdBrl).toFixed(2).replace('.', ',')].join(';')))
          .join('\r\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tokens-por-${g}.csv"` });
        return res.end('﻿' + csv);
      }

      if (req.method === 'GET' && p === '/api/whatsapp') {
        await evolution.connectionState();
        return send(res, 200, { estado: whatsappState(), qr: lastQr });
      }

      if (req.method === 'POST' && p === '/api/whatsapp/conectar') {
        const setup = await evolution.ensureInstance();
        if (setup.state === 'open') return send(res, 200, { estado: 'open' });
        const r = await evolution.connect();
        lastQr = r.base64 || lastQr;
        return send(res, 200, { estado: whatsappState(), qr: lastQr, pairingCode: r.pairingCode || null });
      }

      if (req.method === 'POST' && p === '/api/whatsapp/desconectar') {
        await evolution.logout();
        await evolution.connectionState();
        return send(res, 200, { estado: whatsappState() });
      }

      return send(res, 404, { erro: 'rota não encontrada' });
    } catch (e) {
      console.error('[http]', e);
      if (!res.headersSent) send(res, 500, { erro: e.message });
    }
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`\n🎬 Agente de Vídeo rodando`);
    console.log(`   Painel:  http://localhost:${config.port}`);
    console.log(`   Webhook: http://${config.webhookHost}:${config.port}/webhook/<segredo>\n`);
  });
  return server;
}
