#!/usr/bin/env node
// Simula o Claude Code (modo -p --output-format stream-json) para testar o agente sem gastar tokens.
// Gera um MP4 de teste com ffmpeg em ./output/final.mp4.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

let prompt = '';
for await (const c of process.stdin) prompt += c;
const resume = process.argv.includes('--resume');
const sid = resume ? process.argv[process.argv.indexOf('--resume') + 1] : '11111111-2222-3333-4444-555555555555';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-teste' });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'promo-video' } }] } });
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Vou montar a cena da oferta.' }] } });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npx remotion render', description: 'Renderiza o vídeo' } }] } });

fs.mkdirSync('output', { recursive: true });
const color = resume ? 'blue' : 'red';
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=540x960:d=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', 'output/final.mp4']);
const ok = r.status === 0;

out({
  type: 'result', subtype: ok ? 'success' : 'error', is_error: !ok, duration_ms: 1234, num_turns: 7, session_id: sid,
  result: resume ? 'Fundo trocado para azul, resto mantido.' : `Vídeo de oferta com fundo vermelho e preço em destaque. (prompt: ${prompt.length} caracteres)`,
  total_cost_usd: 0.5,
  modelUsage: {
    'claude-teste-opus': { inputTokens: 1200, outputTokens: 3400, cacheReadInputTokens: 50000, cacheCreationInputTokens: 8000, costUSD: 0.45 },
    'claude-teste-haiku': { inputTokens: 300, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05 },
  },
});
