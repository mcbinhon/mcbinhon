import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

const envFile = process.env.ENV_FILE || path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const num = (k, d) => {
  const v = Number(env(k, String(d)));
  return Number.isFinite(v) ? v : d;
};

const dataDir = path.resolve(ROOT, env('DATA_DIR', './dados'));

export const config = {
  allowedNumbers: env('ALLOWED_NUMBERS')
    .split(',')
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean),
  triggerWord: env('TRIGGER_WORD', 'edição'),

  evolutionUrl: env('EVOLUTION_URL', 'http://localhost:8080').replace(/\/$/, ''),
  evolutionKey: env('EVOLUTION_API_KEY'),
  instance: env('EVOLUTION_INSTANCE', 'agente-video'),

  port: num('PORT', 3333),
  webhookSecret: env('WEBHOOK_SECRET'),
  webhookHost: env('WEBHOOK_HOST', 'host.docker.internal'),
  dashboardToken: env('DASHBOARD_TOKEN'),

  claudeBin: env('CLAUDE_BIN', 'claude'),
  claudeModel: env('CLAUDE_MODEL'),
  jobTimeoutMin: num('JOB_TIMEOUT_MIN', 45),
  marcaDir: env('MARCA_DIR') ? path.resolve(ROOT, env('MARCA_DIR')) : '',
  agentExtra: env('AGENT_EXTRA'),

  maxVideoMB: num('MAX_WHATSAPP_VIDEO_MB', 15),
  maxAjustes: num('MAX_AJUSTES', 5),
  conversaExpiraMin: num('CONVERSA_EXPIRA_MIN', 120),
  usdBrl: num('USD_BRL', 5.4),

  dataDir,
  jobsDir: path.join(dataDir, 'pedidos'),
  dbFile: path.join(dataDir, 'agente.db'),
};

export function checkConfig() {
  const problems = [];
  if (!config.allowedNumbers.length) problems.push('ALLOWED_NUMBERS está vazio — ninguém seria atendido.');
  if (!config.evolutionKey) problems.push('EVOLUTION_API_KEY está vazio.');
  if (!config.webhookSecret || config.webhookSecret.startsWith('troque'))
    problems.push('WEBHOOK_SECRET não foi trocado — invente um segredo.');
  return problems;
}

fs.mkdirSync(config.jobsDir, { recursive: true });
