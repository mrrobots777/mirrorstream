const H = require("../../lib/html");
const { pegar, pegarJson } = require("../../lib/http");
const { tituloDe } = require("../../lib/tmdb");
const { matchVodTitle, bonusTemporada, bonusNumeroFinal, PEN_SHIPPUDEN_PADRAO, PEN_SHIPPUDEN_ALT, PEN_BORUTO, PEN_FINAL_SEASON, PEN_CLASSICO, PEN_FILME, PEN_HEN } = require("../../lib/match");
const { extractQuality } = require("../../lib/quality");
const { ascii, words, looseCoverage, extraWords, decodeEntities } = require("../../lib/text");
const { resolver } = require("../../lib/extrator");
const { UA } = require("../../lib/ua");
const { apresenta } = require("../../lib/apresentacao");

const BASE = "https://www.anitube.biz";
const API = `${BASE}/wp-json/wp/v2`;
const SIGLA = "ATB";
const MS = 8e3;
const POR_PAGINA = 100;
const RECUSA = /\bfilmes?\b|\bmovies?\b|\bcinema\b|\bespeciais?s?\b|\bovas?\b|\boavs?\b|\brecap\b|\bresumos?\b|\btrailers?\b|\bheroines\b|\bamostras?\b|\bcreditos\b|\bextras\b|\byuri\b/i;
const CAT_REJECT = /\bfilmes?\b|\bovas?\b|\boavs?\b|\bespeciais?s?\b|\bspecials?\b|\bpt-pt\b|\btrailers?\b|\bextras\b|\bamostras?\b|\bcreditos\b|\bheroines\b/i;
const CAT_STOP = new Set(["dublado", "dublada", "dublagem", "legendado", "legendada", "legenda", "pt", "br", "hd", "full", "online", "assistir", "assistindo", "hdremastered", "remaster", "remasterizado", "completo", "completa", "todos", "todas", "novo", "nova", "a", "o", "e"]);

function plain(s) {
  return ascii(decodeEntities(s));
}

function semEpisodio(titulo) {
  return decodeEntities(titulo)
    .replace(/\s*[-–—|]\s*Epis[óo]dio\s*\d+.*$/i, "")
    .replace(/\s*\((?:dublado|dublada|legendado|legendada|dublagem|legendagem)\)/gi, "")
    .replace(/\s*\b(?:dublado|dublada|dublado|legendado|legendada|dublagem|legendagem)\b\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function numeroDoEpisodio(titulo) {
  const m = decodeEntities(titulo).match(/Epis[óo]dio\s*0*(\d{1,4})/i);
  return m ? Number(m[1]) : null;
}

function notaDoPost(titulo, pedido, temporada) {
  const t = plain(semEpisodio(titulo));
  const q = plain(pedido).trim();
  if (!t || !q) return -100;
  if (matchVodTitle(t, q, true, null)) return 100 + bonusTemporada(t, temporada);
  const cov = looseCoverage(t, q);
  let pontos;
  if (t.includes(q)) pontos = 10;
  else if (cov >= 0.99) pontos = 8;
  else if (cov >= 0.5) pontos = 4;
  else return -100;
  if (RECUSA.test(t)) pontos -= 25;
  pontos += penalidades(t, q);
  pontos += bonusTemporada(t, temporada);
  pontos += bonusNumeroFinal(t, q, temporada, { removeEpisodio: false });
  return pontos;
}

function penalidades(titulo, pedido) {
  let total = 0;
  for (const regra of [PEN_SHIPPUDEN_PADRAO, PEN_SHIPPUDEN_ALT, PEN_BORUTO, PEN_FINAL_SEASON, PEN_HEN, PEN_FILME]) {
    if (!regra.re.test(titulo)) continue;
    if (regra.re.test(pedido)) continue;
    total -= regra.penalty;
  }
  if (PEN_CLASSICO.re.test(titulo)) total -= PEN_CLASSICO.penalty;
  return total;
}

function notaDaCategoria(nome, pedido) {
  const t = plain(nome);
  const q = plain(pedido).trim();
  if (!q) return -100;
  const cov = looseCoverage(t, q);
  if (!t.includes(q) && cov < 0.99) return -100;
  if (CAT_REJECT.test(t)) return -100;
  let pontos = 10;
  pontos -= 8 * extraWords(t, q, CAT_STOP);
  if (/\bdublad/i.test(t)) pontos += 5;
  if (/\blegendad/i.test(t)) pontos -= 2;
  return pontos;
}

function paginaDoEpisodio(total, numero) {
  const alvo = Math.max(1, Math.ceil((Math.max(Number(total) || 0, numero) - numero + 1) / POR_PAGINA));
  const lista = [alvo];
  for (const p of [alvo + 1, alvo - 1, alvo - 2, alvo + 2]) if (p >= 1 && !lista.includes(p)) lista.push(p);
  return lista;
}

async function api(caminho) {
  const r = await pegarJson(`${API}${caminho}`, { ms: MS, headers: { Accept: "application/json", "User-Agent": UA } });
  if (r.status === 400) return { ok: true, status: 400, lista: [] };
  if (!r.ok) throw new Error(`atb HTTP ${r.status || "?"} em ${caminho.slice(0, 60)}`);
  return { ok: true, status: r.status, lista: Array.isArray(r.dados) ? r.dados : null, dados: r.dados };
}

async function categoriasDo(termo) {
  const { lista } = await api(`/categories?search=${encodeURIComponent(termo)}&per_page=20&_fields=id,name,count,slug`);
  return (lista || []).filter((c) => c && c.name && Number(c.count) > 0);
}

async function postsDaCategoria(catId, pagina) {
  if (pagina < 1) return [];
  const { lista } = await api(`/posts?categories=${encodeURIComponent(catId)}&per_page=${POR_PAGINA}&page=${pagina}&_fields=id,title,slug,date`);
  return (lista || []).filter((p) => p && p.title && p.title.rendered);
}

async function buscaPosts(termo) {
  const { lista } = await api(`/posts?search=${encodeURIComponent(termo)}&per_page=20&_fields=id,title,slug,date`);
  return (lista || []).filter((p) => p && p.title && p.title.rendered);
}

async function conteudoDo(post) {
  const id = Number(post && post.id) || 0;
  if (!id) return "";
  const r = await pegarJson(`${API}/posts/${id}?_fields=id,content`, { ms: MS, headers: { Accept: "application/json", "User-Agent": UA } });
  if (!r.ok || !r.dados || !r.dados.content) return "";
  return String(r.dados.content.rendered || "");
}

function base64Relativo(src) {
  const limpo = String(src || "").trim();
  if (!/^\/[A-Za-z0-9+/=_-]{24,}/.test(limpo)) return null;
  const bruto = limpo.slice(1).split("/")[0];
  try {
    const bin = atob(bruto);
    let saida = "";
    for (let i = 0; i < bin.length; i++) saida += String.fromCharCode(bin.charCodeAt(i));
    const url = saida.trim();
    return /^https?:\/\//i.test(url) ? url : null;
  } catch (_) {
    return null;
  }
}

function urlDeVideo(conteudo) {
  const doc = H.parse(conteudo || "");
  const saida = [];
  const paginas = [];
  for (const video of H.seleciona(doc, "video")) {
    const src = decodeEntities(String(video.attrs.src || ""));
    if (!src) continue;
    const m = src.match(/videohls\.php\?d=([^"'&]+)/i);
    if (m) {
      let real = m[1];
      if (!/^https?:\/\//i.test(real)) {
        try {
          real = decodeURIComponent(real);
        } catch (_) {
          real = "";
        }
      }
      if (/^https?:\/\//i.test(real) && !saida.some((s) => s.url === real)) saida.push({ url: real });
      continue;
    }
    if (/\.m3u8(\?|$)/i.test(src) && /^https?:\/\//i.test(src)) {
      if (!saida.some((s) => s.url === src)) saida.push({ url: src });
      continue;
    }
    const pagina = base64Relativo(src);
    if (pagina && !paginas.includes(pagina)) paginas.push(pagina);
  }
  return { playlists: saida, paginas };
}

async function drena(resposta) {
  const tipo = String(resposta.headers.get("content-type") || "").toLowerCase();
  const tamanho = Number(resposta.headers.get("content-length") || 0);
  const pequeno = resposta.status === 206 || (tamanho > 0 && tamanho <= 262144) || (!tamanho && tipo.includes("mpegurl"));
  if (!pequeno) return "";
  try {
    return await resposta.text();
  } catch (_) {
    return "";
  }
}

async function provaDeVida(url, headers) {
  let r = null;
  try {
    r = await pegar(url, { ms: 6e3, headers: Object.assign({ Range: "bytes=0-2047", "User-Agent": UA }, headers || {}) });
  } catch (_) {
    return true;
  }
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  const corpo = await drena(r);
  if (r.status === 403 || r.status === 404 || r.status === 410 || r.status === 451 || r.status >= 500) return false;
  if (tipo.includes("text/html")) return false;
  if (tipo.includes("mpegurl") && !corpo.includes("#EXTM3U")) return false;
  return true;
}

function escolhePost(posts, pedido, numero, temporada) {
  let melhor = null;
  for (const post of posts) {
    const cru = post.title.rendered;
    if (numeroDoEpisodio(cru) !== numero) continue;
    const pontos = notaDoPost(cru, pedido, temporada);
    if (pontos < 5) continue;
    if (!melhor || pontos > melhor.pontos) melhor = { post, pontos };
  }
  return melhor ? melhor.post : null;
}

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const info = await tituloDe(tmdbId, mediaType, season, episode);
  if (!info || !info.titulo) return [];
  const temporada = Number(season) > 0 ? Number(season) : 1;
  const numero = Number(episode) > 0 ? Number(episode) : 1;
  const pedidos = [...new Set([info.titulo, info.original].filter(Boolean).map((t) => String(t).trim()))];
  const termos = [];
  for (const p of pedidos) {
    for (const v of [p, plain(p)]) {
      const t = String(v || "").trim();
      if (t && !termos.includes(t)) termos.push(t);
    }
  }

  const cats = new Map();
  let erro = null;
  const acharCategoria = async (termo) => {
    if (!words(termo).length) return false;
    let lista = [];
    try {
      lista = await categoriasDo(termo);
    } catch (e) {
      if (!erro) erro = e;
      return false;
    }
    for (const c of lista) if (!cats.has(c.id)) cats.set(c.id, c);
    return [...cats.values()].some((c) => notaDaCategoria(c.name, info.titulo) >= 2);
  };

  for (const termo of termos) {
    if (await acharCategoria(termo)) break;
  }
  if (![...cats.values()].some((c) => notaDaCategoria(c.name, info.titulo) >= 2)) {
    const soltos = [];
    for (const p of pedidos) for (const w of words(p)) if (w.length >= 4 && !soltos.includes(w)) soltos.push(w);
    for (const w of soltos.slice(0, 2)) {
      if (await acharCategoria(w)) break;
    }
  }

  const acima = [...cats.values()]
    .map((c) => ({ ...c, nota: notaDaCategoria(c.name, info.titulo) }))
    .filter((c) => c.nota >= 2 && Number(c.count) >= numero)
    .sort((a, b) => b.nota - a.nota || b.count - a.count);

  let post = null;
  let dublado = false;
  for (const cat of acima.slice(0, 2)) {
    for (const pagina of paginaDoEpisodio(cat.count, numero).slice(0, 3)) {
      let posts = [];
      try {
        posts = await postsDaCategoria(cat.id, pagina);
      } catch (e) {
        if (!erro) erro = e;
        continue;
      }
      const achado = escolhePost(posts, info.titulo, numero, temporada);
      if (achado) {
        post = achado;
        dublado = /dublad/i.test(cat.name);
        break;
      }
    }
    if (post) break;
  }

  if (!post) {
    let posts = [];
    for (const termo of termos) {
      if (!words(termo).length) continue;
      try {
        posts = posts.concat(await buscaPosts(termo));
      } catch (e) {
        if (!erro) erro = e;
      }
    }
    const unicos = new Map();
    for (const p of posts) unicos.set(p.id, p);
    post = escolhePost([...unicos.values()], info.titulo, numero, temporada);
    if (post) dublado = /dublad/i.test(post.title.rendered);
  }
  if (!post) {
    if (erro) throw erro;
    return [];
  }

  let conteudo = "";
  try {
    conteudo = await conteudoDo(post);
  } catch (e) {
    if (!erro) erro = e;
  }
  const { playlists, paginas } = urlDeVideo(conteudo);
  if (!playlists.length && !paginas.length) {
    if (erro) throw erro;
    return [];
  }

  const candidatos = [];
  for (const p of playlists) {
    if (!candidatos.some((c) => c.url === p.url)) candidatos.push({ url: p.url });
  }
  for (const pagina of paginas.slice(0, 1)) {
    try {
      const achado = await resolver(pagina, { ms: 6e3, maxPaginas: 2 });
      if (achado && achado.url && !candidatos.some((c) => c.url === achado.url)) candidatos.push({ url: achado.url });
    } catch (e) {
      if (!erro) erro = e;
    }
  }

  const vistos = new Set();
  const saida = [];
  for (const cand of candidatos) {
    if (vistos.has(cand.url)) continue;
    if (!await provaDeVida(cand.url, { Referer: `${BASE}/` })) continue;
    vistos.add(cand.url);
    const idioma = dublado ? "Dublado" : "Legendado";
    saida.push(apresenta({
      sigla: SIGLA,
      url: cand.url,
      titulo: info.titulo,
      ano: info.ano,
      temporada,
      episodio: numero,
      idioma,
      headers: { "User-Agent": UA }
    }));
    if (saida.length >= 4) break;
  }

  if (!saida.length && erro) throw erro;
  return saida;
};
