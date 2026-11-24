// Tipos de vídeo oferecidos no WhatsApp, cada um ligado às skills da iArt
// e com as perguntas que deixam o pedido claro e objetivo.
//
// Pergunta: { key, ask, options?: [{label, value}], optional?, default? , when?(order, media) }

const FORMATO = (padrao = '1080x1920') => ({
  key: 'formato',
  ask: '📐 *Formato do vídeo?*',
  options: [
    { label: 'Vertical 9:16 (Status, Reels, TikTok)', value: '1080x1920' },
    { label: 'Quadrado 1:1 (feed)', value: '1080x1080' },
    { label: 'Horizontal 16:9 (YouTube, TV)', value: '1920x1080' },
  ],
  optional: true,
  default: padrao,
});

const DURACAO = (padrao = '30') => ({
  key: 'duracao',
  ask: '⏱️ *Duração aproximada?*',
  options: [
    { label: '15 segundos', value: '15' },
    { label: '30 segundos', value: '30' },
    { label: '60 segundos', value: '60' },
    { label: 'Deixa com o agente', value: 'livre' },
  ],
  optional: true,
  default: padrao,
});

const MUSICA = {
  key: 'musica',
  ask: '🎵 *Música?*',
  options: [
    { label: 'Trilha criada pelo agente (sem direitos autorais)', value: 'trilha_gerada' },
    { label: 'Sem música', value: 'sem_musica' },
    { label: 'Usar o áudio que eu enviei', value: 'audio_enviado' },
  ],
  optional: true,
  default: 'trilha_gerada',
};

const ESTILO = {
  key: 'estilo',
  ask: '🎨 *Estilo, cores ou clima?* (ex.: alegre, elegante, vermelho e amarelo, minimalista)\nDigite *pular* para deixar com o agente.',
  optional: true,
  default: 'o agente escolhe',
};

const T = (key, ask, extra = {}) => ({ key, ask, ...extra });
const OPC = (key, ask, extra = {}) => ({ key, ask: `${ask}\n_(ou *pular*)_`, optional: true, default: '', ...extra });

export const CATALOG = [
  {
    id: 'slideshow',
    title: 'Slideshow de fotos',
    hint: 'fotos com movimento, transições e música',
    skills: ['photo-slideshow', 'kinetic-typography', 'beat-sync-editing', 'soundtrack', 'animation-principles'],
    requires: ['imagem'],
    questions: [OPC('titulo', '📝 Título ou frase de abertura?'), OPC('ocasiao', '🎉 Qual a ocasião? (aniversário, retrospectiva, evento...)')],
    common: [FORMATO(), DURACAO('30'), MUSICA, ESTILO],
  },
  {
    id: 'promocao',
    title: 'Promoção / oferta',
    hint: 'preço de/por, desconto, cupom, chamada',
    skills: ['promo-video', 'kinetic-typography', 'motion-background', 'soundtrack', 'shot-composition'],
    questions: [
      T('produto', '🛒 *Qual produto ou serviço?*'),
      OPC('preco_de', '💲 Preço *antigo* (de)?'),
      T('preco_por', '💰 *Preço da oferta* (por)? Ou o desconto (ex.: 30% OFF)'),
      OPC('validade', '📅 Validade ou condição? (ex.: só hoje, até sábado, enquanto durar o estoque)'),
      OPC('contato', '📍 Contato, endereço ou @ para aparecer no final?'),
    ],
    common: [FORMATO(), DURACAO('15'), MUSICA, ESTILO],
  },
  {
    id: 'reels',
    title: 'Reels / TikTok com legenda',
    hint: 'gancho forte, legenda animada palavra a palavra',
    skills: ['short-form-video', 'caption-animation', 'kinetic-typography', 'beat-sync-editing', 'soundtrack'],
    questions: [T('tema', '💡 *Qual o tema / a mensagem principal?*'), OPC('gancho', '🪝 Frase de gancho para os 3 primeiros segundos?')],
    common: [FORMATO('1080x1920'), DURACAO('30'), MUSICA, ESTILO],
  },
  {
    id: 'produto',
    title: 'Apresentação de produto / app',
    hint: 'demo com zoom, destaques e chamada final',
    skills: ['product-demo-video', 'launch-video', 'kinetic-typography', 'shot-composition', 'soundtrack'],
    questions: [T('produto', '📦 *Nome do produto ou app?*'), T('beneficios', '✅ *Principais benefícios* (até 3, um por linha)?'), OPC('cta', '👉 Chamada final? (ex.: compre já, baixe o app)')],
    common: [FORMATO(), DURACAO('30'), MUSICA, ESTILO],
  },
  {
    id: 'depoimento',
    title: 'Depoimento de cliente',
    hint: 'citação animada, estrelas e autor',
    skills: ['testimonial-video', 'kinetic-typography', 'motion-background'],
    questions: [T('depoimento', '💬 *Cole o texto do depoimento*'), T('autor', '👤 *Nome do cliente* (e cargo/cidade, se quiser)'), OPC('estrelas', '⭐ Nota em estrelas (1 a 5)?', { default: '5' })],
    common: [FORMATO('1080x1080'), DURACAO('15'), MUSICA, ESTILO],
  },
  {
    id: 'anuncio',
    title: 'Anúncio para redes (Meta / TikTok Ads)',
    hint: 'gancho → oferta → chamada para ação',
    skills: ['ad-creative-video', 'short-form-video', 'kinetic-typography', 'video-delivery-specs', 'soundtrack'],
    questions: [T('oferta', '📣 *O que está anunciando e qual a oferta?*'), OPC('publico', '🎯 Para quem é? (público)'), T('cta', '👉 *Chamada para ação?* (ex.: chame no WhatsApp, visite a loja)')],
    common: [FORMATO('1080x1920'), DURACAO('15'), MUSICA, ESTILO],
  },
  {
    id: 'explicativo',
    title: 'Vídeo explicativo',
    hint: 'como funciona, passo a passo, narrado em texto',
    skills: ['explainer-video', 'diagram-animation', 'whiteboard-animation', 'kinetic-typography', 'motion-art-direction'],
    questions: [T('assunto', '📚 *Qual assunto o vídeo deve explicar?*'), OPC('publico', '🎯 Para quem? (clientes, equipe, alunos...)')],
    common: [FORMATO('1920x1080'), DURACAO('60'), MUSICA, ESTILO],
  },
  {
    id: 'dados',
    title: 'Gráfico / números animados',
    hint: 'corrida de barras, contadores, infográfico',
    skills: ['chart-animation', 'animated-infographic', 'kinetic-typography'],
    questions: [T('dados', '📊 *Cole os números* (ou envie a planilha como documento e digite *anexo*)'), T('titulo', '📝 *Título do gráfico?*')],
    common: [FORMATO('1920x1080'), DURACAO('30'), MUSICA, ESTILO],
  },
  {
    id: 'texto',
    title: 'Frase / texto animado',
    hint: 'tipografia cinética, mensagem, versículo, aviso',
    skills: ['kinetic-typography', 'motion-background', 'soundtrack'],
    questions: [T('texto', '✍️ *Qual o texto que deve aparecer?*')],
    common: [FORMATO(), DURACAO('15'), MUSICA, ESTILO],
  },
  {
    id: 'animacao',
    title: 'Animação desenhada (historinha)',
    hint: 'tudo desenhado em código, sem imagens',
    skills: ['javascript-animation', 'soundtrack', 'animation-principles', 'motion-art-direction'],
    questions: [T('historia', '📖 *Conte a história ou a cena* que quer ver')],
    common: [FORMATO(), DURACAO('30'), MUSICA, ESTILO],
  },
  {
    id: 'broll',
    title: 'Gráficos no meu vídeo falando (b-roll)',
    hint: 'envie um vídeo seu falando; o agente ilustra o que é dito',
    skills: ['talking-head-b-roll', 'caption-animation'],
    requires: ['video'],
    questions: [OPC('legenda', '💬 Quer legenda animada também? (sim/não)', { default: 'sim' })],
    common: [ESTILO],
  },
  {
    id: 'tarja',
    title: 'Tarja de nome (lower third) transparente',
    hint: 'para OBS, Premiere, CapCut — fundo transparente',
    skills: ['lower-thirds'],
    questions: [T('nome', '👤 *Nome* que aparece na tarja'), OPC('cargo', '🏷️ Segunda linha (cargo, @, cidade)?')],
    common: [ESTILO],
  },
  {
    id: 'contagem',
    title: 'Contagem regressiva',
    hint: 'live, inauguração, lançamento',
    skills: ['countdown-video', 'kinetic-typography', 'motion-background', 'soundtrack'],
    questions: [T('evento', '📅 *Contagem para quê?* (ex.: inauguração, live, Black Friday)'), T('tempo', '⏳ *Quanto tempo de contagem?* (ex.: 10 segundos, 5 minutos)')],
    common: [FORMATO(), MUSICA, ESTILO],
  },
  {
    id: 'conversa',
    title: 'Conversa de WhatsApp animada',
    hint: 'história contada em mensagens',
    skills: ['text-message-animation', 'short-form-video'],
    questions: [T('roteiro', '💬 *Escreva o roteiro das mensagens*, uma por linha, assim:\nEu: oi, tudo bem?\nCliente: tudo! tem promoção hoje?')],
    common: [FORMATO('1080x1920'), MUSICA],
  },
  {
    id: 'livre',
    title: 'Livre — descrevo do meu jeito',
    hint: 'o agente escolhe as melhores skills',
    skills: ['motion-art-direction', 'animation-principles', 'shot-composition', 'kinetic-typography', 'soundtrack'],
    questions: [],
    common: [FORMATO(), DURACAO('livre'), MUSICA, ESTILO],
  },
];

export const findType = (id) => CATALOG.find((t) => t.id === id);

export function menuText() {
  return (
    '🎬 *Que tipo de vídeo?* Responda com o número:\n\n' +
    CATALOG.map((t, i) => `*${i + 1}* — ${t.title}\n      _${t.hint}_`).join('\n') +
    '\n\n_Digite *cancelar* a qualquer momento._'
  );
}

/** Lista de perguntas do tipo, já filtrada pelo material recebido. */
export function questionsFor(type, media) {
  const hasAudio = media.some((m) => m.kind === 'audio' || m.kind === 'video');
  return [...type.questions, ...type.common].map((q) =>
    q.key === 'musica' && !hasAudio ? { ...q, options: q.options.filter((o) => o.value !== 'audio_enviado') } : q,
  );
}

export function questionText(q, idx, total) {
  let t = `*(${idx + 1}/${total})* ${q.ask}`;
  if (q.options) t += '\n\n' + q.options.map((o, i) => `*${i + 1}* — ${o.label}`).join('\n');
  if (q.options && q.optional) t += '\n\n_Digite *pular* para o padrão._';
  return t;
}

export function labelFor(type, key, value) {
  const q = [...type.questions, ...type.common].find((x) => x.key === key);
  const opt = q?.options?.find((o) => o.value === value);
  return opt ? opt.label : value;
}

export const ANSWER_LABELS = {
  formato: 'Formato',
  duracao: 'Duração (s)',
  musica: 'Música',
  estilo: 'Estilo',
  titulo: 'Título',
  ocasiao: 'Ocasião',
  produto: 'Produto',
  preco_de: 'Preço de',
  preco_por: 'Preço por',
  validade: 'Validade',
  contato: 'Contato',
  tema: 'Tema',
  gancho: 'Gancho',
  beneficios: 'Benefícios',
  cta: 'Chamada final',
  depoimento: 'Depoimento',
  autor: 'Autor',
  estrelas: 'Estrelas',
  oferta: 'Oferta',
  publico: 'Público',
  assunto: 'Assunto',
  dados: 'Dados',
  texto: 'Texto',
  historia: 'História',
  legenda: 'Legenda',
  nome: 'Nome',
  cargo: 'Linha 2',
  evento: 'Evento',
  tempo: 'Tempo',
  roteiro: 'Roteiro',
  observacoes: 'Observações',
};
