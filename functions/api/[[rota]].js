// API do Desafio do Engajamento da Asfit (https://desafio-asfit.pages.dev).
// - Público: ranking, mural, "ache sua posição" e envio do link do post.
// - Equipe (e-mail e senha do segredo ADMINS): aprova ou recusa os posts e dá pontos extras.
// Regra do ranking (19/10/2026): cada conteúdo aprovado vale os pontos da categoria que a equipe escolhe ao aprovar
// (carrossel em collab de antes e depois 10, reels de treino ou dieta 7, reels de autocuidado 5). O vídeo sobre o que é
// ser Além do Shape vai direto para a equipe e entra como ponto extra (+10). Story não vale ponto: conta para a missão
// dos 7 dias seguidos, que dá o brinde personalizado. Desempate: quem teve o primeiro post aprovado mais cedo.

// Datas do desafio. Se mudarem, mudar também o CONFIG no fim do public/index.html.
const INICIO = '2026-10-16';
const FIM = '2026-11-11';                 // acaba às 23h59 de Brasília
const ULTIMO_ENVIO = '2026-11-12';        // no dia seguinte ainda dá pra mandar o post de "ontem"
const TOPO = 100;                         // quantas aparecem no ranking da página
const POR_PAGINA_MURAL = 24;
const MAX_POR_IP_HORA = 40;               // celular divide IP com muita gente (CGNAT), por isso folgado
const MAX_POR_DIA = 8;                    // links por @ no mesmo dia
const MAX_IDS = 90;                       // o D1 aceita até 100 parâmetros por consulta
const MIN = 60 * 1000;
const DIAS_SESSAO = 30;
const SEM_APROVADO = 99999999999999;

// Categorias que a equipe escolhe ao aprovar. Mudou a regra: mudar aqui e na dobra "Como somar pontos" do public/index.html.
const CATEGORIAS = {
  carrossel: { nome: 'Carrossel em collab de antes e depois', pontos: 10 },
  reels_treino: { nome: 'Reels de treino ou dieta', pontos: 7 },
  reels_autocuidado: { nome: 'Reels de autocuidado', pontos: 5 },
  story: { nome: 'Story (missão dos 7 dias)', pontos: 0 },
};
const SUGESTAO = { post: 'carrossel', reels: 'reels_treino', story: 'story', tiktok: 'reels_treino' }; // o que já vem marcado no painel
const DIAS_MISSAO = 7;                    // stories em dias seguidos para ganhar o brinde

const enc = new TextEncoder();
// Rotas públicas aceitam pedido de qualquer domínio, para a página funcionar hospedada fora do Cloudflare (Netlify).
// O painel da equipe não entra aqui: o login dele é cookie do próprio domínio.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (dados, status = 200, extra = {}) =>
  Response.json(dados, { status, headers: { 'cache-control': 'no-store', ...extra } });
const erro = (mensagem, status = 400, extra = {}) => json({ erro: mensagem, ...extra }, status);

// ===== Datas (Brasil em UTC-3 fixo desde 2019) =====

const diaBrasilia = (ms = Date.now()) => new Date(ms - 180 * MIN).toISOString().slice(0, 10);
function somarDias(dia, n) {
  const d = new Date(dia + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diaValido = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && d >= INICIO && d <= FIM;

// Maior sequência de dias seguidos com story aprovado (a missão pede DIAS_MISSAO)
function sequencia(lista) {
  if (!lista) return 0;
  let maior = 0, atual = 0, antes = '';
  for (const d of [...new Set(lista.split(','))].sort()) {
    atual = antes && somarDias(antes, 1) === d ? atual + 1 : 1;
    if (atual > maior) maior = atual;
    antes = d;
  }
  return maior;
}
const missao = lista => sequencia(lista) >= DIAS_MISSAO;

// ===== @ e link =====

const RESERVADOS = ['p', 'reel', 'reels', 'stories', 'tv', 'explore', 'accounts', 'share', 's'];

function limparArroba(valor) {
  let s = String(valor || '').trim();
  const doLink = s.match(/(?:instagram\.com\/|tiktok\.com\/@)([A-Za-z0-9._]+)/i); // link do perfil colado no lugar do @
  if (doLink) s = doLink[1];
  s = s.replace(/^@+/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s) || /^\.|\.$|\.\./.test(s) || RESERVADOS.includes(s)) return null;
  return s;
}

// Aceita post, reels e story, nos formatos que o "Copiar link" do Instagram gera.
function lerLink(valor) {
  let s = String(valor || '').trim();
  const achou = s.match(/(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/[^\s]+/i);
  if (!achou) return null;
  s = achou[0];
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const partes = u.pathname.split('/').filter(Boolean);
  if (partes[0] === 'stories') {
    const dono = limparArroba(partes[1]);
    if (!dono || !/^\d{5,30}$/.test(partes[2] || '')) return null;
    return { tipo: 'story', dono, link: `https://www.instagram.com/stories/${dono}/${partes[2]}/` };
  }
  // Link curto do "Compartilhar" (instagram.com/share/...): a API tenta descobrir o post de verdade
  if (partes[0] === 'share' && partes.length >= 2 && partes.every(p => /^[A-Za-z0-9_-]{1,80}$/.test(p))) {
    return { tipo: 'post', dono: null, link: `https://www.instagram.com/${partes.join('/')}/`, compartilhado: true };
  }
  let i = 0, dono = null;
  if (partes.length >= 3 && ['p', 'reel', 'reels', 'tv'].includes(partes[1])) { dono = limparArroba(partes[0]); i = 1; }
  const tipo = partes[i], codigo = partes[i + 1];
  if (!['p', 'reel', 'reels', 'tv'].includes(tipo) || !/^[A-Za-z0-9_-]{5,64}$/.test(codigo || '')) return null;
  const reels = tipo === 'reel' || tipo === 'reels';
  return { tipo: reels ? 'reels' : 'post', dono, link: `https://www.instagram.com/${reels ? 'reel' : 'p'}/${codigo}/` };
}

// TikTok (23/10/2026): vídeo e foto (tiktok.com/@perfil/video/ID ou /photo/ID) e os links curtos do "Compartilhar"
// (vm.tiktok.com, vt.tiktok.com e tiktok.com/t/).
function lerTiktok(valor) {
  let s = String(valor || '').trim();
  const achou = s.match(/(?:https?:\/\/)?(?:[a-z]+\.)?tiktok\.com\/[^\s]+/i);
  if (!achou) return null;
  s = achou[0];
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const partes = u.pathname.split('/').filter(Boolean);
  if ((host === 'vm.tiktok.com' || host === 'vt.tiktok.com') && /^[A-Za-z0-9]{5,20}$/.test(partes[0] || '')) {
    return { tipo: 'tiktok', dono: null, link: `https://${host}/${partes[0]}/`, curto: true };
  }
  if (partes[0] === 't' && /^[A-Za-z0-9]{5,20}$/.test(partes[1] || '')) {
    return { tipo: 'tiktok', dono: null, link: `https://www.tiktok.com/t/${partes[1]}/`, curto: true };
  }
  // o link curto às vezes leva a tiktok.com/@/video/ID, com o perfil vazio
  if (/^@[A-Za-z0-9._]{0,40}$/.test(partes[0] || '') && ['video', 'photo'].includes(partes[1]) && /^\d{8,25}$/.test(partes[2] || '')) {
    return { tipo: 'tiktok', dono: null, id: partes[2], link: `https://www.tiktok.com/${partes[0].toLowerCase()}/${partes[1]}/${partes[2]}` };
  }
  const antigo = u.pathname.match(/^\/v\/(\d{8,25})(?:\.html)?$/); // m.tiktok.com/v/ID.html, link antigo do celular
  if (antigo) return { tipo: 'tiktok', dono: null, id: antigo[1], link: `https://m.tiktok.com/v/${antigo[1]}.html` };
  return null;
}

// Abre o link curto do TikTok para achar o vídeo. Link curto que não existe leva para a página inicial do TikTok.
async function resolverTiktok(link) {
  try {
    const r = await fetch(link, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
      signal: AbortSignal.timeout(3000),
    });
    const destino = r.headers.get('location');
    if (!destino) return null;
    const lido = lerTiktok(new URL(destino, link).href);
    if (lido && !lido.curto) return lido;
    return { invalido: true };
  } catch {}
  return null; // não deu para abrir agora: fica o link curto, e a equipe confere
}

async function resolverCompartilhado(link) {
  try {
    const r = await fetch(link, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
      signal: AbortSignal.timeout(3000),
    });
    const destino = r.headers.get('location');
    if (destino) {
      const lido = lerLink(new URL(destino, link).href);
      if (lido && !lido.compartilhado) return lido;
    }
  } catch {}
  return null;
}

// ===== Contas da equipe (mesmo esquema do calendário: PBKDF2 + cookie assinado) =====

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const deHex = h => new Uint8Array((h.match(/../g) || []).map(b => parseInt(b, 16)));
const b64url = t => btoa(String.fromCharCode(...enc.encode(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = t => new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

function iguais(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hmac(env, texto) {
  const chave = await crypto.subtle.importKey('raw', enc.encode(env.SEGREDO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', chave, enc.encode(texto)));
}

async function pbkdf2(senha, salHex) {
  const chave = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deHex(salHex), iterations: 100000 }, chave, 256));
}

function contas(env) {
  try { return JSON.parse(env.ADMINS || '[]'); } catch { return []; }
}

function lerCookie(request, nome) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`));
  return m ? m[1] : null;
}

async function sessao(request, env) {
  const valor = lerCookie(request, 'equipe');
  if (!valor || !env.SEGREDO) return null;
  const [dados, ass] = valor.split('.');
  if (!dados || !ass || !iguais(ass, await hmac(env, 'equipe:' + dados))) return null;
  let email, exp;
  try { [email, exp] = deB64url(dados).split('|'); } catch { return null; }
  if (!(Number(exp) > Date.now())) return null;
  const conta = contas(env).find(c => c.email === email); // conta removida perde o acesso na hora
  return conta ? { email: conta.email, nome: conta.nome, papel: conta.papel } : null;
}

async function entrar(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'desconhecido';
  const agora = Date.now();
  const falhas = await env.DB.prepare('SELECT COUNT(*) AS n FROM tentativas WHERE ip = ? AND momento > ?').bind(ip, agora - 15 * MIN).first();
  if (falhas.n >= 8) return erro('Muitas tentativas erradas. Espere 15 minutos.', 429);
  const corpo = await request.json().catch(() => ({}));
  const email = String(corpo.email || '').trim().toLowerCase();
  const conta = contas(env).find(c => c.email === email);
  const calculado = await pbkdf2(String(corpo.senha || ''), conta ? conta.sal : '00'.repeat(16));
  if (!conta || !env.SEGREDO || !iguais(calculado, conta.hash)) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO tentativas (ip, momento) VALUES (?, ?)').bind(ip, agora),
      env.DB.prepare('DELETE FROM tentativas WHERE momento < ?').bind(agora - 24 * 60 * MIN),
    ]);
    return erro('E-mail ou senha errados.', 401);
  }
  const dados = b64url(`${conta.email}|${agora + DIAS_SESSAO * 24 * 60 * MIN}`);
  const cookie = `equipe=${dados}.${await hmac(env, 'equipe:' + dados)}; Path=/api/equipe; HttpOnly; Secure; SameSite=Lax; Max-Age=${DIAS_SESSAO * 86400}`;
  return json({ email: conta.email, nome: conta.nome, papel: conta.papel }, 200, { 'set-cookie': cookie });
}

// ===== Totais de cada participante =====

// Recalcula conteúdos, dias de story, extras, pontos e pendentes das participantes passadas (até MAX_IDS por vez)
async function recalcular(env, ids) {
  ids = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < ids.length; i += MAX_IDS) {
    const lote = ids.slice(i, i + MAX_IDS);
    const m = lote.map(() => '?').join(',');
    await env.DB.batch([
      env.DB.prepare(`UPDATE participantes SET
        conteudos = (SELECT COUNT(*) FROM posts WHERE posts.participante_id = participantes.id AND status = 'aprovado' AND posts.pontos > 0),
        dias = (SELECT COUNT(DISTINCT dia) FROM posts WHERE posts.participante_id = participantes.id AND status = 'aprovado' AND categoria = 'story'),
        dias_lista = COALESCE((SELECT group_concat(DISTINCT dia) FROM posts WHERE posts.participante_id = participantes.id AND status = 'aprovado' AND categoria = 'story'), ''),
        extras = (SELECT COALESCE(SUM(pontos), 0) FROM extras WHERE extras.participante_id = participantes.id),
        pendentes = (SELECT COUNT(*) FROM posts WHERE posts.participante_id = participantes.id AND status = 'pendente'),
        primeiro = COALESCE((SELECT MIN(enviado_em) FROM posts WHERE posts.participante_id = participantes.id AND status = 'aprovado'), ${SEM_APROVADO}),
        atualizado_em = ?
        WHERE id IN (${m})`).bind(Date.now(), ...lote),
      env.DB.prepare(`UPDATE participantes SET pontos = extras + (SELECT COALESCE(SUM(posts.pontos), 0) FROM posts
        WHERE posts.participante_id = participantes.id AND posts.status = 'aprovado') WHERE id IN (${m})`).bind(...lote),
    ]);
  }
}

const limparCache = env => env.DB.prepare("DELETE FROM cache WHERE chave IN ('painel', 'mural')").run();

const registrar = (env, quem, acao, detalhe = '') =>
  env.DB.prepare('INSERT INTO acoes (momento, por, acao, detalhe) VALUES (?, ?, ?, ?)').bind(Date.now(), quem.nome, acao, String(detalhe).slice(0, 300)).run();

async function posicaoDe(env, p) {
  if (p.bloqueada || !(p.pontos > 0)) return null;
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM participantes WHERE bloqueada = 0 AND pontos > 0
    AND (pontos > ?1 OR (pontos = ?1 AND primeiro < ?2))`).bind(p.pontos, p.primeiro).first();
  return r.n + 1;
}

// O que a participante vê quando busca o próprio @ ou depois de mandar um post
async function situacao(env, arroba) {
  const p = await env.DB.prepare('SELECT id, arroba, conteudos, dias, dias_lista, extras, pontos, pendentes, primeiro, bloqueada FROM participantes WHERE arroba = ?').bind(arroba).first();
  if (!p) return { arroba, existe: false };
  const [recusados, aprovados] = await env.DB.batch([
    env.DB.prepare("SELECT dia, motivo FROM posts WHERE participante_id = ? AND status = 'recusado' ORDER BY revisado_em DESC LIMIT 3").bind(p.id),
    env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE participante_id = ? AND status = 'aprovado'").bind(p.id),
  ]);
  return {
    arroba: p.arroba, existe: true, posicao: await posicaoDe(env, p),
    pontos: p.pontos, conteudos: p.conteudos, extras: p.extras, pendentes: p.pendentes, aprovados: aprovados.results[0].n,
    stories: p.dias, sequencia: sequencia(p.dias_lista), missao: missao(p.dias_lista), dias_missao: DIAS_MISSAO,
    recusados: recusados.results, bloqueada: !!p.bloqueada,
  };
}

// ===== Público =====

async function painel(env) {
  const hoje = diaBrasilia();
  const guardado = await env.DB.prepare("SELECT valor FROM cache WHERE chave = 'painel'").first();
  if (guardado) {
    const v = JSON.parse(guardado.valor);
    if (v.hoje === hoje) return v;
  }
  const r = await env.DB.prepare(`SELECT arroba, pontos, conteudos, dias_lista, extras FROM participantes
    WHERE bloqueada = 0 AND pontos > 0 ORDER BY pontos DESC, primeiro LIMIT ${TOPO}`).all();
  let total = r.results.length;
  if (total >= TOPO) total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM participantes WHERE bloqueada = 0 AND pontos > 0').first()).n;
  const v = {
    hoje, inicio: INICIO, fim: FIM, atualizado_em: Date.now(), participantes: total,
    ranking: r.results.map((p, i) => ({ p: i + 1, a: p.arroba, pts: p.pontos, c: p.conteudos, x: p.extras, m: missao(p.dias_lista) ? 1 : 0 })),
  };
  await env.DB.prepare("INSERT OR REPLACE INTO cache (chave, valor, criado_em) VALUES ('painel', ?, ?)").bind(JSON.stringify(v), Date.now()).run();
  return v;
}

async function mural(env, antes) {
  let cursor = null;
  if (antes) {
    const [t, id] = String(antes).split('-').map(Number);
    if (Number.isFinite(t) && Number.isFinite(id)) cursor = { t, id };
  }
  if (!cursor) {
    const guardado = await env.DB.prepare("SELECT valor FROM cache WHERE chave = 'mural'").first();
    if (guardado) return JSON.parse(guardado.valor);
  }
  const r = await env.DB.prepare(`SELECT p.id, p.link, p.tipo, p.dia, p.enviado_em, pa.arroba FROM posts p
    JOIN participantes pa ON pa.id = p.participante_id
    WHERE p.status = 'aprovado' AND pa.bloqueada = 0 ${cursor ? 'AND (p.enviado_em < ?1 OR (p.enviado_em = ?1 AND p.id < ?2))' : ''}
    ORDER BY p.enviado_em DESC, p.id DESC LIMIT ${POR_PAGINA_MURAL + 1}`).bind(...(cursor ? [cursor.t, cursor.id] : [])).all();
  const linhas = r.results.slice(0, POR_PAGINA_MURAL);
  const ultimo = linhas[linhas.length - 1];
  const v = {
    posts: linhas.map(p => ({ id: p.id, a: p.arroba, t: p.tipo, d: p.dia, l: p.link })),
    proximo: r.results.length > POR_PAGINA_MURAL && ultimo ? `${ultimo.enviado_em}-${ultimo.id}` : null,
  };
  if (!cursor) await env.DB.prepare("INSERT OR REPLACE INTO cache (chave, valor, criado_em) VALUES ('mural', ?, ?)").bind(JSON.stringify(v), Date.now()).run();
  return v;
}

async function hashIp(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(ip + '|' + (env.SEGREDO || 'desafio-asfit')))).slice(0, 24);
}

async function enviar(request, env) {
  const corpo = await request.json().catch(() => null);
  if (!corpo) return erro('Pedido inválido.');
  if (corpo.site) return json({ ok: true }); // campo escondido: só robô preenche
  const agora = Date.now();
  const hoje = diaBrasilia(agora);
  if (hoje > ULTIMO_ENVIO) return erro('O desafio acabou dia 11/11.', 410);
  if (hoje < INICIO) return erro('O desafio começa dia 16/10.');

  const arroba = limparArroba(corpo.arroba);
  if (!arroba) return erro('Confere o seu @. Só vale letra, número, ponto e _.', 400, { campo: 'arroba' });
  let lido = lerTiktok(corpo.link) || lerLink(corpo.link);
  if (!lido) return erro('Cola aqui o link de um post, reels ou story do Instagram, ou de um vídeo do TikTok.', 400, { campo: 'link' });
  if (lido.compartilhado) lido = (await resolverCompartilhado(lido.link)) || lido;
  if (lido.curto) {
    const aberto = await resolverTiktok(lido.link);
    if (aberto && aberto.invalido) return erro('Esse link do TikTok não abre. Copia de novo em Compartilhar e Copiar link.', 400, { campo: 'link' });
    if (aberto) lido = aberto;
  }
  // O @ dela pode ser do Instagram ou do TikTok (23/10/2026), então link de outro perfil não é recusado:
  // o painel mostra o perfil do link e a equipe confere se é ela.
  const dia = corpo.quando === 'ontem' ? somarDias(hoje, -1) : hoje;
  if (dia < INICIO) return erro('O desafio começou hoje, então marca “Hoje”.', 400, { campo: 'quando' });
  if (dia > FIM) return erro('O desafio acabou dia 11/11. Só dá pra mandar o post de ontem.', 400, { campo: 'quando' });

  const ip = await hashIp(request, env);
  const porIp = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE ip = ? AND enviado_em > ?').bind(ip, agora - 60 * MIN).first();
  if (porIp.n >= MAX_POR_IP_HORA) return erro('Muitos envios seguidos. Espera uns minutinhos e tenta de novo.', 429);

  await env.DB.prepare('INSERT OR IGNORE INTO participantes (arroba, criado_em) VALUES (?, ?)').bind(arroba, agora).run();
  const p = await env.DB.prepare('SELECT id, bloqueada FROM participantes WHERE arroba = ?').bind(arroba).first();
  if (p.bloqueada) return erro('Esse perfil não está participando do desafio.', 403, { campo: 'arroba' });

  // TikTok: o mesmo vídeo pode chegar com e sem o perfil no link, então compara pelo número do vídeo
  const repetido = lido.id
    ? await env.DB.prepare("SELECT participante_id FROM posts WHERE link = ?1 OR (tipo = 'tiktok' AND link LIKE ?2)").bind(lido.link, `%/${lido.id}%`).first()
    : await env.DB.prepare('SELECT participante_id FROM posts WHERE link = ?').bind(lido.link).first();
  if (repetido) {
    return repetido.participante_id === p.id
      ? erro('Esse post já tá aqui. Agora é só esperar a equipe aprovar.', 409, { campo: 'link' })
      : erro('Esse link já foi enviado por outro perfil.', 409, { campo: 'link' });
  }
  const doDia = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE participante_id = ? AND dia = ?').bind(p.id, dia).first();
  if (doDia.n >= MAX_POR_DIA) return erro('Você já mandou bastante coisa desse dia. Agora é esperar a equipe conferir.', 429);

  try {
    await env.DB.prepare('INSERT INTO posts (participante_id, link, tipo, dia, status, enviado_em, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(p.id, lido.link, lido.tipo, dia, 'pendente', agora, ip).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) return erro('Esse link já foi enviado.', 409, { campo: 'link' });
    throw e;
  }
  await recalcular(env, [p.id]);
  return json({ ok: true, dia, eu: await situacao(env, arroba) });
}

// ===== Equipe =====

async function resumo(env) {
  return env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM posts WHERE status = 'pendente') AS pendentes,
    (SELECT COUNT(*) FROM posts WHERE status = 'pendente' AND tipo = 'story') AS stories,
    (SELECT COUNT(*) FROM participantes WHERE bloqueada = 0 AND pontos > 0) AS no_ranking`).first();
}

async function pendentes(env) {
  const r = await env.DB.prepare(`SELECT p.id, p.link, p.tipo, p.dia, p.enviado_em, pa.arroba, pa.conteudos, pa.pontos,
      (SELECT COUNT(*) FROM posts q WHERE q.participante_id = p.participante_id AND q.dia = p.dia AND q.status = 'aprovado' AND q.categoria = 'story') AS story_no_dia
    FROM posts p JOIN participantes pa ON pa.id = p.participante_id
    WHERE p.status = 'pendente'
    ORDER BY CASE p.tipo WHEN 'story' THEN 0 ELSE 1 END, p.enviado_em
    LIMIT 60`).all();
  return {
    posts: r.results.map(p => ({ ...p, sugestao: SUGESTAO[p.tipo] || 'carrossel' })),
    resumo: await resumo(env), hoje: diaBrasilia(), inicio: INICIO, fim: FIM, categorias: CATEGORIAS,
  };
}

async function revisar(env, quem, corpo) {
  const ids = [...new Set((Array.isArray(corpo.ids) ? corpo.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!ids.length) return erro('Nenhum post escolhido.');
  if (ids.length > MAX_IDS) return erro(`No máximo ${MAX_IDS} posts por vez.`);
  const m = ids.map(() => '?').join(',');
  const afetados = (await env.DB.prepare(`SELECT DISTINCT participante_id FROM posts WHERE id IN (${m})`).bind(...ids).all()).results.map(r => r.participante_id);
  const acao = corpo.acao;
  if (acao === 'apagar') {
    await env.DB.prepare(`DELETE FROM posts WHERE id IN (${m})`).bind(...ids).run();
  } else {
    const status = { aprovar: 'aprovado', recusar: 'recusado', pendente: 'pendente' }[acao];
    if (!status) return erro('Ação inválida.');
    if (corpo.categoria && !CATEGORIAS[corpo.categoria]) return erro('Categoria inválida.');
    const revisado = status !== 'pendente';
    const motivo = status === 'recusado' ? (String(corpo.motivo || '').trim().slice(0, 120) || null) : null;
    let sql = 'UPDATE posts SET status = ?, revisado_em = ?, revisado_por = ?, motivo = ?';
    const args = [status, revisado ? Date.now() : null, revisado ? quem.nome : null, motivo];
    if (status !== 'aprovado') {
      sql += ', categoria = NULL, pontos = 0';
    } else if (corpo.categoria) {
      sql += ', categoria = ?, pontos = ?';
      args.push(corpo.categoria, CATEGORIAS[corpo.categoria].pontos);
    } else {
      // sem categoria escolhida, vale a sugestão de cada tipo de link
      const caso = campo => 'CASE tipo ' + Object.entries(SUGESTAO).map(([tipo, c]) => `WHEN '${tipo}' THEN ${campo(c)}`).join(' ') + ` ELSE ${campo('carrossel')} END`;
      sql += `, categoria = ${caso(c => `'${c}'`)}, pontos = ${caso(c => CATEGORIAS[c].pontos)}`;
    }
    if (corpo.dia) {
      if (!diaValido(corpo.dia)) return erro('Dia fora do desafio.');
      sql += ', dia = ?';
      args.push(corpo.dia);
    }
    await env.DB.prepare(`${sql} WHERE id IN (${m})`).bind(...args, ...ids).run();
  }
  await recalcular(env, afetados);
  await limparCache(env);
  await registrar(env, quem, acao, `${ids.length} post(s): ${ids.join(',')}${corpo.categoria && acao === 'aprovar' ? ' | ' + CATEGORIAS[corpo.categoria].nome : ''}${corpo.motivo ? ' | ' + corpo.motivo : ''}${corpo.dia ? ' | dia ' + corpo.dia : ''}`);
  return json({ ok: true, resumo: await resumo(env) });
}

async function listarParticipantes(env, url) {
  const busca = String(url.searchParams.get('busca') || '').trim().toLowerCase().replace(/^@/, '').replace(/[%_]/g, '');
  const pagina = Math.max(0, Number(url.searchParams.get('pagina')) || 0);
  const r = await env.DB.prepare(`SELECT arroba, pontos, conteudos, dias, extras, pendentes, bloqueada, dias_lista FROM participantes
    WHERE (?1 = '' OR arroba LIKE ?2)
    ORDER BY bloqueada, pontos DESC, primeiro, arroba LIMIT 51 OFFSET ?3`).bind(busca, `%${busca}%`, pagina * 50).all();
  return json({
    participantes: r.results.slice(0, 50).map(p => ({ ...p, dias_lista: undefined, sequencia: sequencia(p.dias_lista), missao: missao(p.dias_lista) })),
    mais: r.results.length > 50, hoje: diaBrasilia(),
  });
}

async function detalhe(env, arroba) {
  const p = await env.DB.prepare('SELECT * FROM participantes WHERE arroba = ?').bind(arroba).first();
  if (!p) return null;
  const [posts, extras] = await env.DB.batch([
    env.DB.prepare('SELECT id, link, tipo, dia, status, categoria, pontos, enviado_em, revisado_por, motivo FROM posts WHERE participante_id = ? ORDER BY dia DESC, enviado_em DESC').bind(p.id),
    env.DB.prepare('SELECT id, pontos, motivo, criado_em, por FROM extras WHERE participante_id = ? ORDER BY criado_em DESC').bind(p.id),
  ]);
  return {
    arroba: p.arroba, pontos: p.pontos, conteudos: p.conteudos, extras: p.extras, pendentes: p.pendentes, bloqueada: !!p.bloqueada,
    posicao: await posicaoDe(env, p), stories: p.dias, sequencia: sequencia(p.dias_lista), missao: missao(p.dias_lista),
    dias_missao: DIAS_MISSAO, posts: posts.results, lista_extras: extras.results, categorias: CATEGORIAS,
  };
}

async function darExtras(env, quem, corpo) {
  const arroba = limparArroba(corpo.arroba);
  const pontos = Math.trunc(Number(corpo.pontos));
  const motivo = String(corpo.motivo || '').trim().slice(0, 120);
  if (!arroba) return erro('Confere o @.');
  if (!pontos || pontos < -50 || pontos > 50) return erro('Os pontos vão de -50 a 50 (e não podem ser 0).');
  if (!motivo) return erro('Escreva o motivo dos pontos.');
  await env.DB.prepare('INSERT OR IGNORE INTO participantes (arroba, criado_em) VALUES (?, ?)').bind(arroba, Date.now()).run();
  const p = await env.DB.prepare('SELECT id FROM participantes WHERE arroba = ?').bind(arroba).first();
  await env.DB.prepare('INSERT INTO extras (participante_id, pontos, motivo, criado_em, por) VALUES (?, ?, ?, ?, ?)').bind(p.id, pontos, motivo, Date.now(), quem.nome).run();
  await recalcular(env, [p.id]);
  await limparCache(env);
  await registrar(env, quem, 'extras', `@${arroba} ${pontos > 0 ? '+' : ''}${pontos} (${motivo})`);
  return json({ ok: true, participante: await detalhe(env, arroba) });
}

async function apagarExtras(env, quem, id) {
  const e = await env.DB.prepare('SELECT e.participante_id, e.pontos, e.motivo, p.arroba FROM extras e JOIN participantes p ON p.id = e.participante_id WHERE e.id = ?').bind(id).first();
  if (!e) return erro('Esses pontos já não existem.', 404);
  await env.DB.prepare('DELETE FROM extras WHERE id = ?').bind(id).run();
  await recalcular(env, [e.participante_id]);
  await limparCache(env);
  await registrar(env, quem, 'desfazer extras', `@${e.arroba} ${e.pontos} (${e.motivo})`);
  return json({ ok: true, participante: await detalhe(env, e.arroba) });
}

async function bloquear(env, quem, corpo) {
  const arroba = limparArroba(corpo.arroba);
  if (!arroba) return erro('Confere o @.');
  const r = await env.DB.prepare('UPDATE participantes SET bloqueada = ? WHERE arroba = ?').bind(corpo.bloqueada ? 1 : 0, arroba).run();
  if (!r.meta.changes) return erro('Esse @ não está no desafio.', 404);
  await limparCache(env);
  await registrar(env, quem, corpo.bloqueada ? 'tirar do ranking' : 'voltar ao ranking', '@' + arroba);
  return json({ ok: true, participante: await detalhe(env, arroba) });
}

async function listarPosts(env, url) {
  const status = ['aprovado', 'recusado', 'pendente'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'aprovado';
  const busca = String(url.searchParams.get('busca') || '').trim().toLowerCase().replace(/^@/, '').replace(/[%_]/g, '');
  const pagina = Math.max(0, Number(url.searchParams.get('pagina')) || 0);
  const r = await env.DB.prepare(`SELECT p.id, p.link, p.tipo, p.dia, p.status, p.categoria, p.pontos, p.enviado_em, p.revisado_por, p.motivo, pa.arroba
    FROM posts p JOIN participantes pa ON pa.id = p.participante_id
    WHERE p.status = ?1 AND (?2 = '' OR pa.arroba LIKE ?3)
    ORDER BY p.enviado_em DESC, p.id DESC LIMIT 61 OFFSET ?4`).bind(status, busca, `%${busca}%`, pagina * 60).all();
  return json({ posts: r.results.slice(0, 60), mais: r.results.length > 60 });
}

async function rankingCsv(env) {
  const r = await env.DB.prepare(`SELECT arroba, pontos, conteudos, dias, extras, dias_lista FROM participantes
    WHERE bloqueada = 0 AND (pontos > 0 OR dias > 0) ORDER BY pontos DESC, primeiro`).all();
  const hoje = diaBrasilia();
  const linhas = [['posição', 'arroba', 'pontos', 'conteúdos aprovados', 'pontos extras', 'dias com story', 'maior sequência de stories', 'missão dos 7 dias'].join(';')];
  r.results.forEach((p, i) => linhas.push([p.pontos > 0 ? i + 1 : '-', '@' + p.arroba, p.pontos, p.conteudos, p.extras, p.dias, sequencia(p.dias_lista), missao(p.dias_lista) ? 'sim' : 'não'].join(';')));
  return new Response('﻿' + linhas.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ranking-desafio-asfit-${hoje}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

async function historico(env) {
  const r = await env.DB.prepare('SELECT momento, por, acao, detalhe FROM acoes ORDER BY id DESC LIMIT 80').all();
  return json({ acoes: r.results });
}

// ===== Rotas =====

export async function onRequest(context) {
  const { request, params } = context;
  const rota = Array.isArray(params.rota) ? params.rota : [params.rota].filter(Boolean);
  if (rota[0] === 'equipe') return rotas(context, rota);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const r = await rotas(context, rota);
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(r.body, { status: r.status, headers: h });
}

async function rotas(context, rota) {
  const { request, env } = context;
  const [a, b, c] = rota;
  const metodo = request.method;
  const url = new URL(request.url);
  const corpo = async () => await request.json().catch(() => null);

  try {
    if (metodo === 'GET' && a === 'painel' && !b) return json(await painel(env), 200, { 'cache-control': 'public, max-age=10' });
    if (metodo === 'GET' && a === 'mural' && !b) return json(await mural(env, url.searchParams.get('antes')), 200, { 'cache-control': 'public, max-age=10' });
    if (metodo === 'GET' && a === 'eu' && !b) {
      const arroba = limparArroba(url.searchParams.get('arroba'));
      if (!arroba) return erro('Confere o seu @.', 400, { campo: 'arroba' });
      return json(await situacao(env, arroba));
    }
    if (metodo === 'POST' && a === 'enviar' && !b) return enviar(request, env);

    if (a === 'equipe') {
      if (b === 'entrar' && metodo === 'POST') return entrar(request, env);
      if (b === 'sair' && metodo === 'POST') return json({ ok: true }, 200, { 'set-cookie': 'equipe=; Path=/api/equipe; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
      const quem = await sessao(request, env);
      if (b === 'eu' && metodo === 'GET') return json(quem); // null quando não entrou
      if (!quem) return erro('Entre com o seu e-mail e senha.', 401);

      if (b === 'pendentes' && metodo === 'GET') return json(await pendentes(env));
      if (b === 'resumo' && metodo === 'GET') return json(await resumo(env));
      if (b === 'revisar' && metodo === 'POST') {
        const dados = await corpo();
        return dados ? revisar(env, quem, dados) : erro('Pedido inválido.');
      }
      if (b === 'participantes' && metodo === 'GET') return listarParticipantes(env, url);
      if (b === 'participante' && metodo === 'GET') {
        const arroba = limparArroba(url.searchParams.get('arroba'));
        const d = arroba && await detalhe(env, arroba);
        return d ? json(d) : erro('Esse @ não está no desafio.', 404);
      }
      if (b === 'extras' && !c && metodo === 'POST') {
        const dados = await corpo();
        return dados ? darExtras(env, quem, dados) : erro('Pedido inválido.');
      }
      if (b === 'extras' && c && metodo === 'DELETE') return apagarExtras(env, quem, Number(c));
      if (b === 'bloquear' && metodo === 'POST') {
        const dados = await corpo();
        return dados ? bloquear(env, quem, dados) : erro('Pedido inválido.');
      }
      if (b === 'posts' && metodo === 'GET') return listarPosts(env, url);
      if (b === 'ranking.csv' && metodo === 'GET') return rankingCsv(env);
      if (b === 'historico' && metodo === 'GET') return historico(env);
      return erro('Rota não encontrada.', 404);
    }

    return erro('Rota não encontrada.', 404);
  } catch (e) {
    return erro('Erro no servidor: ' + (e && e.message || e), 500);
  }
}
