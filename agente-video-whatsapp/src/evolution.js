// Cliente mínimo da Evolution API v2 (WhatsApp open source via Baileys).
import { config } from './config.js';

let lastState = 'desconhecido';
export const whatsappState = () => lastState;
export const setWhatsappState = (s) => (lastState = s || lastState);

async function call(method, route, body) {
  const res = await fetch(`${config.evolutionUrl}${route}`, {
    method,
    headers: { apikey: config.evolutionKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Evolution ${method} ${route} → ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const inst = () => encodeURIComponent(config.instance);

export const evolution = {
  sendText(to, text) {
    return call('POST', `/message/sendText/${inst()}`, { number: to, text });
  },

  /** mediatype: image | video | document | audio ; media = base64 puro */
  sendMedia(to, { mediatype, mimetype, fileName, caption, base64 }) {
    return call('POST', `/message/sendMedia/${inst()}`, {
      number: to,
      mediatype,
      mimetype,
      fileName,
      caption,
      media: base64,
    });
  },

  /** Baixa a mídia de uma mensagem recebida (quando o webhook não trouxe o base64). */
  getMediaBase64(message) {
    return call('POST', `/chat/getBase64FromMediaMessage/${inst()}`, {
      message: { key: { id: message.key.id } },
      convertToMp4: false,
    });
  },

  async connectionState() {
    try {
      const r = await call('GET', `/instance/connectionState/${inst()}`);
      lastState = r?.instance?.state || r?.state || 'desconhecido';
    } catch (e) {
      lastState = e.status === 404 ? 'sem_instancia' : 'evolution_offline';
    }
    return lastState;
  },

  /** Retorna { base64 (data:image/png...), pairingCode } para conectar o celular. */
  connect(number) {
    return call('GET', `/instance/connect/${inst()}${number ? `?number=${number}` : ''}`);
  },

  logout() {
    return call('DELETE', `/instance/logout/${inst()}`);
  },

  /** Cria a instância (se não existir) e aponta o webhook para este agente. */
  async ensureInstance() {
    const list = await call('GET', `/instance/fetchInstances?instanceName=${inst()}`).catch(() => []);
    const exists = Array.isArray(list) && list.some((i) => (i.name || i.instance?.instanceName) === config.instance);
    if (!exists) {
      await call('POST', '/instance/create', {
        instanceName: config.instance,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
      });
    }
    const url = `http://${config.webhookHost}:${config.port}/webhook/${encodeURIComponent(config.webhookSecret)}`;
    await call('POST', `/webhook/set/${inst()}`, {
      webhook: {
        enabled: true,
        url,
        byEvents: false,
        base64: true,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
    });
    await this.connectionState();
    return { created: !exists, webhook: url, state: lastState };
  },
};
