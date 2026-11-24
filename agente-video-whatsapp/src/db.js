import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT NOT NULL,
  reply_to      TEXT NOT NULL,
  contact_name  TEXT,
  status        TEXT NOT NULL,          -- coletando | na_fila | gerando | entregue | finalizado | falhou | cancelado | expirado
  step          TEXT NOT NULL,          -- etapa da conversa (media, tipo, q:N, ideia, confirmar, ajuste, confirmar_ajuste, fim)
  video_type    TEXT,
  answers       TEXT NOT NULL DEFAULT '{}',
  idea          TEXT,
  pending_fix   TEXT,                   -- pedido de ajuste aguardando confirmação / execução
  session_id    TEXT,                   -- sessão do Claude (para ajustes)
  revisions     INTEGER NOT NULL DEFAULT 0,
  output_file   TEXT,
  summary       TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  started_at    TEXT,
  delivered_at  TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  INTEGER NOT NULL,
  ts        TEXT NOT NULL,
  kind      TEXT NOT NULL,              -- entrada | saida | agente | sistema | erro
  text      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_order ON events(order_id);
CREATE TABLE IF NOT EXISTS media (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  INTEGER NOT NULL,
  ts        TEXT NOT NULL,
  kind      TEXT NOT NULL,              -- imagem | video | audio | documento
  mimetype  TEXT,
  file      TEXT NOT NULL,              -- caminho relativo à pasta do pedido
  size      INTEGER,
  caption   TEXT
);
CREATE INDEX IF NOT EXISTS media_order ON media(order_id);
CREATE TABLE IF NOT EXISTS usage (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id           INTEGER NOT NULL,
  run                INTEGER NOT NULL,  -- 0 = geração, 1.. = ajustes
  ts                 TEXT NOT NULL,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL NOT NULL DEFAULT 0,
  duration_ms        INTEGER,
  turns              INTEGER
);
CREATE INDEX IF NOT EXISTS usage_ts ON usage(ts);
`);

/** Data/hora local "AAAA-MM-DD HH:MM:SS" (agrupa certo por dia/mês/ano no fuso do PC). */
export function now(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const parse = (o) => (o ? { ...o, answers: JSON.parse(o.answers || '{}') } : null);

export const Orders = {
  create({ phone, replyTo, name }) {
    const t = now();
    const r = db
      .prepare(`INSERT INTO orders (phone, reply_to, contact_name, status, step, created_at, updated_at)
                VALUES (?, ?, ?, 'coletando', 'media', ?, ?)`)
      .run(phone, replyTo, name || null, t, t);
    return this.get(Number(r.lastInsertRowid));
  },
  get(id) {
    return parse(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  },
  update(id, fields) {
    const f = { ...fields, updated_at: now() };
    if (f.answers && typeof f.answers !== 'string') f.answers = JSON.stringify(f.answers);
    const keys = Object.keys(f);
    db.prepare(`UPDATE orders SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...keys.map((k) => f[k] ?? null),
      id,
    );
    return this.get(id);
  },
  /** Pedido "aberto" do número: em conversa, na fila/gerando, ou entregue aguardando retorno. */
  activeFor(phone) {
    return parse(
      db
        .prepare(`SELECT * FROM orders WHERE phone = ?
                  AND (status IN ('coletando','na_fila','gerando') OR (status = 'entregue' AND step IN ('ajuste','confirmar_ajuste')))
                  ORDER BY id DESC LIMIT 1`)
        .get(phone),
    );
  },
  byStatus(...statuses) {
    return db
      .prepare(`SELECT * FROM orders WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY id`)
      .all(...statuses)
      .map(parse);
  },
  list({ status, q, limit = 200 } = {}) {
    const where = [];
    const args = [];
    if (status) {
      where.push('o.status = ?');
      args.push(status);
    }
    if (q) {
      where.push('(o.idea LIKE ? OR o.video_type LIKE ? OR o.answers LIKE ? OR CAST(o.id AS TEXT) = ?)');
      args.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
    }
    return db
      .prepare(`SELECT o.id, o.phone, o.contact_name, o.status, o.step, o.video_type, o.idea, o.revisions,
                       o.created_at, o.updated_at, o.started_at, o.delivered_at, o.error,
                       COALESCE(SUM(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens),0) AS tokens,
                       COALESCE(SUM(u.cost_usd),0) AS cost_usd,
                       (SELECT COUNT(*) FROM media m WHERE m.order_id = o.id) AS media_count
                FROM orders o LEFT JOIN usage u ON u.order_id = o.id
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                GROUP BY o.id ORDER BY o.id DESC LIMIT ?`)
      .all(...args, limit);
  },
};

export const Events = {
  add(orderId, kind, text) {
    db.prepare('INSERT INTO events (order_id, ts, kind, text) VALUES (?, ?, ?, ?)').run(
      orderId,
      now(),
      kind,
      String(text).slice(0, 4000),
    );
  },
  forOrder(orderId) {
    return db.prepare('SELECT * FROM events WHERE order_id = ? ORDER BY id').all(orderId);
  },
};

export const Media = {
  add(orderId, { kind, mimetype, file, size, caption }) {
    db.prepare('INSERT INTO media (order_id, ts, kind, mimetype, file, size, caption) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      orderId,
      now(),
      kind,
      mimetype || null,
      file,
      size || 0,
      caption || null,
    );
  },
  forOrder(orderId) {
    return db.prepare('SELECT * FROM media WHERE order_id = ? ORDER BY id').all(orderId);
  },
  get(id) {
    return db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  },
};

export const Usage = {
  add(orderId, run, u) {
    db.prepare(`INSERT INTO usage (order_id, run, ts, model, input_tokens, output_tokens, cache_read_tokens,
                cache_write_tokens, cost_usd, duration_ms, turns) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      orderId,
      run,
      now(),
      u.model || 'desconhecido',
      u.input || 0,
      u.output || 0,
      u.cacheRead || 0,
      u.cacheWrite || 0,
      u.cost || 0,
      u.durationMs ?? null,
      u.turns ?? null,
    );
  },
  forOrder(orderId) {
    return db.prepare('SELECT * FROM usage WHERE order_id = ? ORDER BY id').all(orderId);
  },
  /** Relatório agrupado por dia | mes | ano, entre datas (AAAA-MM-DD, inclusivas). */
  report(group = 'dia', from, to) {
    const len = { dia: 10, mes: 7, ano: 4 }[group] || 10;
    const where = [];
    const args = [];
    if (from) {
      where.push('substr(ts,1,10) >= ?');
      args.push(from);
    }
    if (to) {
      where.push('substr(ts,1,10) <= ?');
      args.push(to);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = db
      .prepare(`SELECT substr(ts,1,${len}) AS periodo,
                       COUNT(DISTINCT order_id) AS pedidos, COUNT(*) AS execucoes,
                       SUM(input_tokens) AS input, SUM(output_tokens) AS output,
                       SUM(cache_read_tokens) AS cache_read, SUM(cache_write_tokens) AS cache_write,
                       SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) AS total,
                       SUM(cost_usd) AS cost_usd
                FROM usage ${w} GROUP BY periodo ORDER BY periodo`)
      .all(...args);
    const models = db
      .prepare(`SELECT model, COUNT(*) AS execucoes, SUM(input_tokens) AS input, SUM(output_tokens) AS output,
                       SUM(cache_read_tokens) AS cache_read, SUM(cache_write_tokens) AS cache_write,
                       SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) AS total,
                       SUM(cost_usd) AS cost_usd
                FROM usage ${w} GROUP BY model ORDER BY total DESC`)
      .all(...args);
    return { rows, models };
  },
  totals(prefix) {
    return db
      .prepare(`SELECT COALESCE(SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens),0) AS total,
                       COALESCE(SUM(cost_usd),0) AS cost_usd FROM usage WHERE ts LIKE ?`)
      .get(prefix + '%');
  },
};

export function statusCounts(prefix = '') {
  return db
    .prepare('SELECT status, COUNT(*) AS n FROM orders WHERE created_at LIKE ? GROUP BY status')
    .all(prefix + '%')
    .reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});
}
