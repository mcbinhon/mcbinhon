// Utilidades de mídia: salvar o que chega, conferir e preparar o vídeo para o WhatsApp (ffmpeg).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function run(cmd, args, { cwd, timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, stdout, stderr: String(e) });
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
};

const safeName = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 60);

/** Grava o base64 recebido em <pasta do pedido>/input e devolve o caminho relativo. */
export function saveIncoming(jobDir, seq, { kind, mimetype, base64, fileName }) {
  const inputDir = path.join(jobDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });
  const mt = (mimetype || '').split(';')[0].trim();
  let ext = EXT[mimetype] || EXT[mt] || (fileName && path.extname(fileName).slice(1)) || 'bin';
  ext = safeName(ext) || 'bin';
  const base = fileName ? safeName(path.basename(fileName, path.extname(fileName))) : kind;
  const name = `${String(seq).padStart(3, '0')}_${base || kind}.${ext}`;
  const buf = Buffer.from(base64, 'base64');
  fs.writeFileSync(path.join(inputDir, name), buf);
  return { rel: `input/${name}`, size: buf.length };
}

export async function probe(file) {
  const r = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    timeoutMs: 60_000,
  });
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const v = (j.streams || []).find((s) => s.codec_type === 'video');
    const a = (j.streams || []).find((s) => s.codec_type === 'audio');
    return {
      duration: Number(j.format?.duration || v?.duration || 0),
      size: Number(j.format?.size || 0),
      width: v?.width,
      height: v?.height,
      vcodec: v?.codec_name,
      acodec: a?.codec_name,
    };
  } catch {
    return null;
  }
}

/**
 * Decide como mandar o arquivo:
 *  - MP4 até o limite → vídeo normal
 *  - MP4 maior → comprime com ffmpeg para caber; se não der, manda como documento (sem perda)
 *  - outros formatos (ex.: .mov/.webm com transparência) → documento
 */
export async function prepareForWhatsApp(file, maxMB) {
  const ext = path.extname(file).toLowerCase();
  const size = fs.statSync(file).size;
  const limit = maxMB * 1024 * 1024;
  if (ext !== '.mp4') return { file, as: 'document', note: 'formato especial, enviado como arquivo' };
  const info = await probe(file);
  const compatible = info && info.vcodec === 'h264' && (!info.acodec || info.acodec === 'aac');
  if (size <= limit && compatible) return { file, as: 'video' };

  const duration = info?.duration || 0;
  if (!duration) return { file, as: 'document', note: 'não consegui medir a duração' };
  const totalKbps = Math.floor(((limit * 8) / 1000 / duration) * 0.92);
  const audioKbps = 128;
  const videoKbps = totalKbps - audioKbps;
  if (videoKbps < 450) return { file, as: 'document', note: 'vídeo longo, enviado como arquivo para não perder qualidade' };

  const out = file.replace(/\.mp4$/i, '_whatsapp.mp4');
  const r = await run(
    'ffmpeg',
    ['-y', '-i', file, '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps}k`,
      '-bufsize', `${videoKbps * 2}k`, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${audioKbps}k`,
      '-movflags', '+faststart', out],
    { timeoutMs: 20 * 60_000 },
  );
  if (r.code === 0 && fs.existsSync(out) && fs.statSync(out).size <= limit * 1.05) return { file: out, as: 'video', note: 'comprimido para o WhatsApp' };
  return { file, as: 'document', note: 'enviado como arquivo (tamanho)' };
}

export const mimeOf = (file) =>
  ({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.gif': 'image/gif', '.png': 'image/png', '.zip': 'application/zip' })[
    path.extname(file).toLowerCase()
  ] || 'application/octet-stream';
