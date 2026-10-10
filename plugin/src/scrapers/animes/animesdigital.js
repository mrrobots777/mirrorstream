const H = require("../../lib/html");
const { pegar, pegarJson } = require("../../lib/http");
const { tituloDe } = require("../../lib/tmdb");
const { matchVodTitle, bonusTemporada, PEN_SHIPPUDEN_PADRAO, PEN_SHIPPUDEN_ALT, PEN_BORUTO, PEN_FINAL_SEASON, PEN_FILME, PEN_HEN } = require("../../lib/match");
const { resolver } = require("../../lib/extrator");
const { extractQuality } = require("../../lib/quality");
const { apresenta } = require("../../lib/apresentacao");
const { decodeEntities, normalizeLoose, lower } = require("../../lib/text");
const { UA } = require("../../lib/ua");

const BASE = "https://animesdigital.org";
const SIGLA = "RON";
const MS = 8e3;
const PEDIDO = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" };
const PARADAS = new Set([
  "dublado", "dublada", "dublagem", "legendado", "legendada", "legenda", "pt", "br", "hd", "full",
  "online", "assistir", "assistindo", "todos", "todas", "episodios", "episodio", "completo", "completa",
  "remaster", "remasterizado", "remasterizacao", "classico", "classica", "a", "o", "e", "as", "os",
  "temp", "temporada", "temporadas", "part", "parte", "season", "versao", "com", "sem", "nova", "novo"
]);
const RECUSA = /\bfilmes?\b|\bmovies?\b|\bheroines\b|\bfilme\b|\bova\b|\bovas\b|\bespeciais?\b|\bspecials?\b|\bextras\b|\brecursos?\b|\bresumos?\b|\btrailers?\b|\bamostras?\b|\beducacional\b|\bmusical\b|\bescolinha\b|\bamigos\b|\bcarros?\b/i;

function pagina(url) {
  return pegar(url, { ms: MS, headers: PEDIDO }).then(async (r) => {
    if (!r.ok) throw new Error(`ron HTTP ${r.status} em ${url.slice(0, 90)}`);
    return r.text();
  });
}

function palavras(txt) {
  return lower(String(txt || ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function semQualificador(titulo) {
  return decodeEntities(String(titulo || ""))
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s*[-–—|]\s*(?:dublado|dublada|legendado|legendada|dublagem|legendagem)\s*$/i, " ")
    .replace(/\s+(?:dublado|dublada|legendado|legendada|dublagem|legendagem)\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function candidatosDe(html) {
  const doc = H.parse(html);
  const out = [];
  const vistos = new Set();
  for (const div of H.seleciona(doc, "div")) {
    if (!/(^|\s)itemA(\s|$)/.test(String(div.attrs.class || ""))) continue;
    for (const a of H.seleciona(div, "a")) {
      const href = String(a.attrs.href || "");
      if (!/\/anime\//.test(href)) continue;
      const span = H.um(a, "span.title_anime");
      const titulo = semQualificador(H.textoDe(span));
      if (!titulo || vistos.has(href)) continue;
      vistos.add(href);
      out.push({ titulo, url: href.startsWith("http") ? href : `${BASE}${href}` });
    }
  }
  return out;
}

function proximaPaginaDeBusca(html) {
  const doc = H.parse(html);
  for (const a of H.seleciona(doc, "a")) {
    if (/\/page\/\d+\//.test(String(a.attrs.href || ""))) {
      const href = a.attrs.href;
      return href.startsWith("http") ? href : `${BASE}${href}`;
    }
  }
  return null;
}

function nota(cand, pedido, temporada) {
  const bruto = decodeEntities(String(cand.titulo || ""));
  if (matchVodTitle(bruto, pedido, true, null)) return 100 + bonusTemporada(bruto, temporada);
  if (RECUSA.test(bruto)) return -100;
  const t = palavras(semQualificador(bruto));
  const q = palavras(pedido);
  if (!t.length || !q.length) return -100;
  let pontos = 0;
  if (normalizeLoose(semQualificador(bruto)) === normalizeLoose(pedido)) pontos = 100;
  else if (q.every((p, i) => t[i] === p)) {
    const resto = t.slice(q.length);
    const fora = resto.filter((p) => !PARADAS.has(p) && !/^\d+$/.test(p));
    pontos = fora.length ? 0 : 100 - fora.length * 10 - resto.length * 2;
  } else if (t.every((p, i) => q[i] === p)) {
    const resto = q.slice(t.length);
    const fora = resto.filter((p) => !PARADAS.has(p));
    pontos = fora.length ? 0 : 80;
  } else return -100;
  const marca = PEN_SHIPPUDEN_PADRAO.re.test(bruto) || PEN_SHIPPUDEN_ALT.re.test(bruto) || PEN_BORUTO.re.test(bruto) || PEN_FINAL_SEASON.re.test(bruto) || PEN_HEN.re.test(bruto);
  if (marca && !PEN_SHIPPUDEN_PADRAO.re.test(pedido) && !PEN_SHIPPUDEN_ALT.re.test(pedido) && !PEN_BORUTO.re.test(pedido) && !PEN_FINAL_SEASON.re.test(pedido)) pontos -= 60;
  if (/\b(?:filme|movie)\b/i.test(bruto) && !/\b(?:filme|movie)\b/i.test(pedido)) pontos -= 60;
  pontos += bonusTemporada(bruto, temporada);
  return pontos;
}

function indiceDe(html) {
  const doc = H.parse(html);
  const paginas = new Set([1]);
  for (const a of H.seleciona(doc, "a")) {
    const m = String(a.attrs.href || "").match(/\/page\/(\d+)\//);
    if (m) paginas.add(Number(m[1]));
  }
  let canonica = null;
  for (const link of H.seleciona(doc, "link")) {
    if (String(link.attrs.rel || "").toLowerCase() === "canonical" && link.attrs.href) {
      canonica = link.attrs.href;
      break;
    }
  }
  const eps = new Map();
  for (const a of H.seleciona(doc, "a")) {
    const href = String(a.attrs.href || "");
    if (!/\/video\/[^/]+/.test(href)) continue;
    const img = H.um(a, "img");
    const alt = decodeEntities(String((img && img.attrs.alt) || H.textoDe(a)));
    const m = alt.match(/Epis[óo]dio\s*0*(\d+)/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > 0 && !eps.has(n)) eps.set(n, href.startsWith("http") ? href : `${BASE}${href}`);
  }
  return { paginas, canonica, eps, porPagina: eps.size || 50 };
}

function paginaDoEpisodio(indice, numero) {
  const numeros = [...indice.eps.keys()];
  if (!numeros.length) return [];
  const maximo = Math.max(...numeros);
  const ultima = Math.max(...indice.paginas);
  const porPagina = indice.porPagina;
  const alvo = Math.min(ultima, Math.max(1, Math.ceil((maximo - numero + 1) / porPagina)));
  const lista = [alvo];
  for (const p of [alvo + 1, alvo - 1, ultima]) if (p >= 1 && p <= ultima && !lista.includes(p)) lista.push(p);
  return lista;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// A EXTRAÇÃO DO VIDEO — refeita em 02/10/2026 (medido)
//
// O QUE MUDOU: a pagina de episodio trocou o `<iframe>` do player por um link de anuncio
// (`ad-protected-cover` -> `investcentro.com` -> `mixumenu.com`). Medido em 4 paginas
// (100968, 100969, 101500 e 137130, a mais nova do `post-sitemap1.xml`):
//
//     m3u8/mp4 = 0    iframe = 0    jwplayer( = 0
//
// A pagina ainda traz, no cabecalho `link:` (o dono nao escondeu nada):
//
//     <https://animesdigital.org/chave/wp/v2/posts/100968>; rel="alternate"; title="JSON"
//
// `/wp-json/` responde 404 (117 KB de pagina de erro), mas `/chave/wp/v2/` responde 200. O
// namespace `/chave` e' o de translation do WPmultibyte.
//
// O VIDEO CONTINUA NO AR: o caminho do CDN e' DERIVAVEL do slug do post + o episodio do titulo.
// Medido com um episodio postado no dia:
//
//     GET /chave/wp/v2/posts/139066 -> {"slug":"nige-jouzu-no-wakagimi-2-8",
//                                       "title":{"rendered":"… Episódio 12"}}
//     GET cdn-s01.mywallpaper-4k-image.net/stream/sv/n/nige-jouzu-no-wakagimi-2/12.mp4/index.m3u8
//         -> 200, application/vnd.apple.mpegurl, 142 segmentos
//     GET …/12.mp4/seg-1-v1-a1.webp (Range 0-262143, SEM Referer)
//         -> 206, video/MP2T, 262144 B, 2424 sync bytes -> MPEG-TS valido
//
// DUAS REGRAS, e cada uma custou ~20% de acerto quando foi ignorada:
//
// 1. **O EPISODIO VEM DO TITULO**, nunca do slug. Medido: "One Piece (Dublado) Dublado
//    Episódio 01" tem slug `one-piece-dublado-325` — pelo slug sairia o 325.
// 2. **O WORDPRESS ANEXA UM CONTADOR AO SLUG** (`-8`, `-15`, `-325`) que NAO existe na pasta do
//    CDN. Medido: `nige-jouzu-no-wakagimi-2-8` -> 404; `nige-jouzu-no-wakagimi-2` -> 200.
//
// EXISTE UM SEGUNDO HOST, COM LAYOUT DIFERENTE (medido): `cdn-sv01.maximaimg.online`, SEM o
// `sv` no bucket. `Jujutsu Kaisen 3 Dublado` e `Solo Leveling 2 Dublado` — os mais pedidos —
// nao estao no primeiro. Os dois entram como candidatos, e a prova decide.
//
// O RISCO RESIDUAL, dito com clareza: o par `(host, layout)` so e' descobrivel por historico
// (Wayback), nao no site ao vivo — medido, nao ha mais nenhum vazamento de CDN em pagina
// viva. Se o dono trocar de host de novo, a fonte quebra ate a lista de candidatos ser
// atualizada. Por isso sao DOIS, e a lista e' uma constante facil de acrescentar.
const REST_BASE = "https://animesdigital.org/chave/wp/v2";

// Os candidatos sao tentados NESTA ordem. O primeiro que provar playlist com segmento vence.
// Medido 02/10/2026: o `mywallpaper` responde 4/4 na amostra e o `maximaimg` cobre o que o
// primeiro nao tem.
const CDNS = [
  { host: "https://cdn-s01.mywallpaper-4k-image.net", prefixo: "sv" },
  { host: "https://cdn-sv01.maximaimg.online", prefixo: "" },
];

/** O numero do episodio vem do TITULO do post — nunca do slug (medido). */
function episodioDoTitulo(titulo) {
  const m = String(titulo || "")
    .replace(/&[a-z]+;/gi, " ")
    .match(/ep[íi]s[óo]dio\s*0*(\d{1,4})/i);
  if (m) return Number(m[1]);
  // Sem a palavra "Episódio": ultimo numero isolado do titulo (`… 12`).
  const nums = String(titulo || "").match(/(?:^|\s)(\d{1,4})(?:\s|$)/g);
  if (nums && nums.length) return Number(String(nums[nums.length - 1]).trim());
  return null;
}

/**
 * O WordPress anexa um contador ao slug do post que NAO existe na pasta do CDN.
 * Medido: `nige-jouzu-no-wakagimi-2-8` -> 404; `nige-jouzu-no-wakagimi-2` -> 200.
 *
 * O corte e' do ULTIMO `-<so digitos>` ou `-episodio-<NN>`. Um numero que faz PARTE do nome
 * (`slime-datta-ken-2`) tem de sobreviver — por isso o `2` do fim nao e' cortado aqui.
 */
function slugDeCdn(slug) {
  let s = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
  s = s.replace(/-episodio-\d{1,4}$/i, "");
  const m = s.match(/^(.*)-\d{1,4}$/);
  if (m && m[1]) s = m[1];
  return s;
}

/**
 * Os candidatos de URL: 2 layouts de host x as VARIANTES de slug.
 *
 * A variacao do slug nao e' uma otimizacao, e' uma admissao de que o dado nao permite decidir:
 * o WordPress anexa contador (`-8`) ao slug, mas a serie pode legitimately terminar em numero
 * (`nige-jouzu-no-wakagimi-2`). Pelo slug nao ha como saber qual dos dois e' contador, entao os
 * dois vao para a fila e a prova da playlist decide. Medido: cortar sempre acerta
 * `nige-jouzu-no-wakagimi-2-8`; manter sempre acerta quem ja termina em numero.
 */
function caminhosDeCdn(slugDoPost, episodio) {
  const original = String(slugDoPost || "").trim().replace(/^\/+|\/+$/g, "");
  const cortado = slugDeCdn(original);
  // Sem numero no fim, as duas variantes sao a mesma string — e nao ha o que tentar duas vezes.
  const variantes = cortado === original ? [original] : [cortado, original];
  const ep = pad2(episodio);
  const out = [];
  for (const base of variantes) {
    const letra = (base.charAt(0) || "a").toLowerCase();
    for (const c of CDNS) {
      const bucket = c.prefixo ? `/${c.prefixo}/${letra}` : `/${letra}`;
      out.push({ host: c.host, url: `${c.host}/stream${bucket}/${base}/${ep}.mp4/index.m3u8` });
    }
  }
  return out;
}

function pad2(n) {
  return String(Number(n) || 0).padStart(2, "0");
}

/** O post do episodio, pela REST. O id vem do link `/video/a/<id><sufixo>`. */
async function postDoEpisodio(epUrl) {
  const id = String(epUrl || "").match(/\/video\/a\/(\d+)/);
  if (!id) return null;
  const r = await pegarJson(`${REST_BASE}/posts/${id[1]}?_fields=id,slug,title`, {
    ms: MS,
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!r.ok) return null;
  const dados = r.dados;
  if (!dados || !dados.slug) return null;
  return { slug: dados.slug, titulo: dados.title && dados.title.rendered };
}

/**
 * O VIDEO do episodio. Substitui o `resolver()`/iframe, que dependia de um elemento que a
 * pagina trocou por anuncio.
 */
async function videoDoPost(epUrl) {
  const post = await postDoEpisodio(epUrl);
  if (!post) return null;
  const ep = episodioDoTitulo(post.titulo);
  if (!ep) return null;
  const candidatos = caminhosDeCdn(post.slug, ep);
  for (const c of candidatos) {
    try {
      const r = await pegar(c.url, { ms: MS, headers: { "User-Agent": UA, Range: "bytes=0-2047" } });
      if (!r.ok) continue;
      const texto = await r.text();
      if (!texto.includes("#EXTM3U")) continue;
      const segmentos = texto.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      if (!segmentos.length) continue;
      return c.url;
    } catch (_) {
      // Rede: tenta o proximo candidato. O ultimo erro nao condena a fonte.
    }
  }
  return null;
}

// A pagina de episodio NAO tem mais iframe (medido 02/10/2026: `<iframe>` = 0, e o slot virou
// link de anuncio). O caminho do video e' a REST do WordPress + o CDN, derivados do slug do
// post. `epHtml` nao e' mais consultado — fica no assinatura para nao mexer no chamador.
async function videoDe(_epHtml, epUrl) {
  return videoDoPost(epUrl);
}

function idiomaDe(titulo) {
  return /dublad/i.test(decodeEntities(String(titulo || ""))) ? "Dublado" : "Legendado";
}

async function drena(r) {
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  const tamanho = Number(r.headers.get("content-length") || 0);
  const pequeno = r.status === 206 || (tamanho > 0 && tamanho <= 262144) || (!tamanho && tipo.includes("mpegurl"));
  if (!pequeno) return "";
  try {
    return await r.text();
  } catch (_) {
    return "";
  }
}

async function provaDeVida(url) {
  let r = null;
  try {
    r = await pegar(url, { ms: 6e3, headers: { Range: "bytes=0-2047", "User-Agent": UA } });
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

// As regras de derivacao sao exportadas porque sao a PARTE QUE QUEBRA: sao elas que decidem o
// caminho do CDN, e o `test/fonte-ron.test.js` (na raiz, sem rede) trava cada uma com um par que
// foi MEDIDO — o slug com contador que da 404, o titulo que mente sobre o episodio, e os dois
// layouts de host. Exportar a regra e' o que permite testar sem a origem estar no ar.
module.exports.episodioDoTitulo = episodioDoTitulo;
module.exports.slugDeCdn = slugDeCdn;
module.exports.caminhosDeCdn = caminhosDeCdn;
module.exports.postDoEpisodio = postDoEpisodio;
module.exports.videoDoPost = videoDoPost;

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const info = await tituloDe(tmdbId, mediaType, season, episode);
  if (!info || !info.titulo) return [];
  const serie = String(mediaType || "").toLowerCase() === "tv";
  const temporada = Number(season) > 0 ? Number(season) : 1;
  const numero = Number(episode) > 0 ? Number(episode) : 1;

  const termos = [...new Set([info.titulo, info.original].filter(Boolean).map((t) => String(t).trim()))];
  let lista = [];
  let proxima = null;
  let erro = null;
  for (const termo of termos) {
    if (!palavras(termo).length) continue;
    let html = "";
    try {
      html = await pagina(`${BASE}/pesquisa/?s=${encodeURIComponent(termo)}`);
    } catch (e) {
      if (!erro) erro = e;
      continue;
    }
    const novos = candidatosDe(html);
    for (const c of novos) if (!lista.some((x) => x.url === c.url)) lista.push(c);
    if (lista.some((c) => nota(c, info.titulo, temporada) >= 0)) break;
    if (!proxima) proxima = proximaPaginaDeBusca(html);
  }
  if (!lista.length && erro) throw erro;

  let acima = lista.filter((c) => nota(c, info.titulo, temporada) >= 0);
  if (!acima.length && proxima) {
    const segunda = candidatosDe(await pagina(proxima));
    for (const c of segunda) if (!lista.some((x) => x.url === c.url)) lista.push(c);
    acima = lista.filter((c) => nota(c, info.titulo, temporada) >= 0);
  }
  if (!acima.length) return [];
  acima.sort((a, b) => nota(b, info.titulo, temporada) - nota(a, info.titulo, temporada));

  const saida = [];
  const vistos = new Set();
  let falha = null;
  for (const cand of acima.slice(0, 3)) {
    try {
      const html = await pagina(cand.url);
      const indice = indiceDe(html);
      let alvo = indice.eps.get(numero) || null;
      if (!alvo) {
        const bases = [...new Set([(indice.canonica || "").replace(/\/$/, ""), cand.url.replace(/\/$/, "")])].filter(Boolean);
        for (const base of bases) {
          for (const p of paginaDoEpisodio(indice, numero).slice(0, 3)) {
            const alvoPagina = p === 1 ? `${base}/` : `${base}/page/${p}/`;
            const lista2 = indiceDe(await pagina(alvoPagina));
            if (lista2.eps.has(numero)) {
              alvo = lista2.eps.get(numero);
              break;
            }
          }
          if (alvo) break;
        }
      }
      if (!alvo) continue;
      const epHtml = await pagina(alvo);
      const url = await videoDe(epHtml, alvo);
      if (!url || vistos.has(url)) continue;
      if (!await provaDeVida(url)) continue;
      vistos.add(url);
      const qualidade = extractQuality(url);
      saida.push(apresenta({
        sigla: SIGLA,
        url,
        qualidade,
        idioma: idiomaDe(cand.titulo),
        titulo: info.titulo,
        ano: info.ano,
        temporada,
        episodio: numero,
        headers: { "User-Agent": UA }
      }));
      if (saida.length >= 10) break;
    } catch (e) {
      if (!falha) falha = e;
    }
  }
  if (!saida.length && falha) throw falha;
  return saida;
};
