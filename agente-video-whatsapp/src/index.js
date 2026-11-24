import { checkConfig, config } from './config.js';
import { evolution } from './evolution.js';
import { restoreQueue } from './queue.js';
import { startServer } from './server.js';

const problems = checkConfig();
if (problems.length) {
  console.warn('⚠️  Ajuste o arquivo .env:\n   - ' + problems.join('\n   - '));
}

startServer();
restoreQueue();

// Liga a instância do WhatsApp e o webhook assim que a Evolution API responder.
(async function connectEvolution(attempt = 1) {
  try {
    const r = await evolution.ensureInstance();
    console.log(`📱 Evolution API ok — instância "${config.instance}" ${r.created ? 'criada' : 'encontrada'}, estado: ${r.state}`);
    if (r.state !== 'open') console.log(`   Abra o painel e clique em "Conectar WhatsApp" para ler o QR code.`);
  } catch (e) {
    if (attempt === 1) console.log(`⏳ Aguardando a Evolution API em ${config.evolutionUrl} (docker compose up -d)...`);
    if (attempt % 10 === 0) console.log(`   ainda sem resposta: ${e.message}`);
    setTimeout(() => connectEvolution(attempt + 1), 6000);
  }
})();

// estado da conexão a cada minuto (para o painel)
setInterval(() => evolution.connectionState().catch(() => {}), 60_000);
