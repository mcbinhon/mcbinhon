// Teste de ponta a ponta SEM WhatsApp real e SEM gastar tokens:
// sobe uma Evolution API falsa + usa o claude-falso.mjs e conversa como se fosse o celular.
//   npm run teste
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-teste-'));
const MEU = '5541998765432';

Object.assign(process.env, {
  ENV_FILE: path.join(tmp, 'nao-existe.env'),
  ALLOWED_NUMBERS: '554198765432', // sem o 9: testa a normalização do 9º dígito
  EVOLUTION_URL: 'http://127.0.0.1:18080',
  EVOLUTION_API_KEY: 'chave-teste',
  WEBHOOK_SECRET: 'segredo-teste',
  WEBHOOK_HOST: '127.0.0.1',
  PORT: '13333',
  CLAUDE_BIN: path.join(ROOT, 'scripts', 'claude-falso.mjs'),
  DATA_DIR: tmp,
  MAX_WHATSAPP_VIDEO_MB: '15',
});

// ---------- Evolution falsa ----------
const sent = [];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const evo = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const body = b ? JSON.parse(b) : {};
    const reply = (o) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)));
    if (req.url.startsWith('/message/sendText')) sent.push({ type: 'text', to: body.number, text: body.text });
    if (req.url.startsWith('/message/sendMedia')) sent.push({ type: body.mediatype, to: body.number, caption: body.caption, bytes: Buffer.from(body.media, 'base64').length });
    if (req.url.startsWith('/chat/getBase64FromMediaMessage')) return reply({ base64: PNG, mimetype: 'image/png' });
    if (req.url.startsWith('/instance/connectionState')) return reply({ instance: { state: 'open' } });
    if (req.url.startsWith('/instance/fetchInstances')) return reply([]);
    reply({ ok: true });
  });
});
await new Promise((r) => evo.listen(18080, '127.0.0.1', r));

await import('../src/index.js');
await new Promise((r) => setTimeout(r, 500));

let n = 0;
async function wa(text, { media, from = MEU } = {}) {
  const message = media ? { imageMessage: { mimetype: 'image/png', caption: text || '' }, ...(media === 'b64' ? { base64: PNG } : {}) } : { conversation: text };
  await fetch('http://127.0.0.1:13333/webhook/segredo-teste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'messages.upsert', instance: 'agente-video', data: { key: { id: `MSG${++n}`, remoteJid: `${from}@s.whatsapp.net`, fromMe: false }, pushName: 'Eu', message } }),
  });
  await new Promise((r) => setTimeout(r, 150));
}
const last = () => sent.at(-1)?.text || sent.at(-1)?.caption || '';
const waitFor = async (fn, ms = 30_000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('tempo esgotado esperando condição');
    await new Promise((r) => setTimeout(r, 200));
  }
};

// 1) número estranho é ignorado
await wa('edição', { from: '5511900000000' });
assert.equal(sent.length, 0, 'número não autorizado não deve receber resposta');

// 2) conversa completa
await wa('Edição');
assert.match(last(), /Novo pedido #1/);
await wa('', { media: 'b64' });
await wa('logo nova', { media: 'fetch' }); // sem base64 no webhook → baixa pela API
await new Promise((r) => setTimeout(r, 4000));
assert.match(last(), /2 foto/);
await wa('pronto');
assert.match(last(), /Que tipo de vídeo/);
await wa('2'); // promoção
assert.match(last(), /Qual produto/);
await wa('pular');
assert.match(last(), /necessária/);
await wa('Dipirona 500mg');
await wa('R$ 12,90');
await wa('R$ 7,99');
await wa('pular'); // validade
await wa('Rua das Flores, 100');
await wa('1'); // formato vertical
await wa('2'); // 30 s
await wa('1'); // trilha
await wa('vermelho e amarelo');
assert.match(last(), /descreva a sua ideia/i);
await wa('Quero o preço piscando e a frase "só esta semana" no final');
assert.match(last(), /Resumo do pedido #1/);
assert.match(last(), /Dipirona/);
await wa('1');
await waitFor(() => sent.some((s) => s.type === 'video'));
await waitFor(() => /Gostou\?/.test(last()));
const video = sent.find((s) => s.type === 'video');
assert.ok(video.bytes > 1000 && /Pedido \*#1\* pronto/.test(video.caption));

// 3) ajuste
await wa('deixa o fundo azul');
assert.match(last(), /Vou ajustar/);
await wa('1');
await waitFor(() => sent.filter((s) => s.type === 'video').length === 2);
await waitFor(() => /Gostou\?/.test(last()));
await wa('ok');
assert.match(last(), /finalizado/);

// 4) status e painel
await wa('status');
assert.match(last(), /#1/);
const pedido = await (await fetch('http://127.0.0.1:13333/api/pedidos/1')).json();
assert.equal(pedido.status, 'finalizado');
assert.equal(pedido.revisions, 1);
assert.equal(pedido.midias.length, 2);
assert.equal(pedido.uso.length, 4); // 2 modelos × (geração + ajuste)
const tokens = await (await fetch('http://127.0.0.1:13333/api/tokens?agrupar=mes')).json();
assert.equal(tokens.rows[0].total, 2 * (1200 + 3400 + 50000 + 8000 + 300 + 200));
assert.equal(Math.round(tokens.rows[0].cost_usd * 100), 100);
const csv = await (await fetch('http://127.0.0.1:13333/api/tokens.csv?agrupar=ano')).text();
assert.match(csv, /periodo;pedidos/);
const html = await (await fetch('http://127.0.0.1:13333/')).text();
assert.match(html, /Agente de Vídeo/);
const prompt = fs.readFileSync(path.join(tmp, 'pedidos', '1', 'prompt.txt'), 'utf8');
assert.match(prompt, /promo-video/);
assert.match(prompt, /R\$ 7,99/);

// 5) cancelar no meio da conversa
await wa('edição');
await wa('cancelar');
assert.match(last(), /cancelado/);

console.log('\n✅ Teste de ponta a ponta OK');
console.log(`   ${sent.length} mensagens enviadas ao "celular"; pasta de teste: ${tmp}`);
console.log('\n--- conversa (saídas do agente) ---');
for (const s of sent) console.log(`[${s.type}] ${(s.text || s.caption || '').split('\n')[0].slice(0, 100)}`);
process.exit(0);
