import { Events } from './db.js';
import { evolution } from './evolution.js';

/** Manda texto no WhatsApp e registra no histórico do pedido. */
export async function say(order, text) {
  Events.add(order.id, 'saida', text);
  try {
    await evolution.sendText(order.reply_to, text);
  } catch (e) {
    Events.add(order.id, 'erro', `Falha ao enviar mensagem: ${e.message}`);
    console.error('[whatsapp] envio falhou:', e.message);
  }
}

/** Mensagem sem pedido associado (ex.: ajuda). */
export async function sayRaw(to, text) {
  try {
    await evolution.sendText(to, text);
  } catch (e) {
    console.error('[whatsapp] envio falhou:', e.message);
  }
}
