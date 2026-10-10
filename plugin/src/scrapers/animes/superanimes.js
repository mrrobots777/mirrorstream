// Fonte SAN — Super Animes (`api.animestvs.org`).
//
// MEDIDO 08/10/2026 deste servidor. A API e' JSON puro, sem token e sem crypto:
//
//   `GET /animes-legendados/<slug>/episodios` -> array de
//        `{id, anime, episodio, link_video, tipo, created_at, visualizacoes, image}`
//   `GET /animes-dublados/<slug>/episodios`   -> idem, com `tipo: "Dublado"`
//
// O `link_video` ja e' MP4 direto (MEDIDO: `cdn.animestvs.org/legendados/fullhd/233121.mp4`
// devolveu `206 video/mp4` com 1920x1080 lido do arquivo), entao nao ha player nem HLS
// para resolver — a fonte mais simples do lote depois do Isekai.
//
// O PROBLEMA do runtime e' o titulo, e ele e' medido: o catalogo completo
// (`GET /animes-legendados`) tem **7.307 itens e 4,7 MB**, e o teto de corpo do Nuvio e'
// **1 MB**. Baixar o catalogo inteiro e' o caminho que o codigo do addon usa com
// `stream-json` — unavailable no plugin. Por isso a fonte NAO tenta o catalogo: ela
// deriva o slug do TITULO que o TMDB ja deu e pede so a lista de episodios daquele anime.
// MEDIDO: `naruto`, `one-piece` e `boruto-naruto-next-generations` respondem 200 assim.
//
// A lista por anime cabe: One Piece (1.176 episodios) devolve 326 KB, e Naruto 57 KB. O
// `episodio` vem como texto ("Episódio 1050") e e' dele que sai o numero pedido.
//
// O `Referer` e' obrigatorio: MEDIDO, sem ele o CDN do video responde 403.
const { pegar, pegarJson } = require("../../lib/http");
const { tituloDe } = require("../../lib/tmdb");
const { extractQuality } = require("../../lib/quality");
const { apresenta } = require("../../lib/apresentacao");
const { UA } = require("../../lib/ua");

const API = "https://api.animestvs.org";
const SITE = "https://animestvs.org";
const SIGLA = "SAN";
const MS = 8e3;
const REFERER = `${SITE}/`;
const CABECALHOS = { "User-Agent": UA, Referer: REFERER, Accept: "application/json" };
// A lista tem um episodio por linha: uma linha e' a resposta completa. O limite existe
// so para o `slice` final deixar a forma explicita se a origem passar a devolver tiers.

// O slug e' o que a origem usa no caminho. O mesmo titulo do TMDB pode produzir slugs
// diferentes (`"One Piece"` -> `one-piece`, mas o catalogo tambem tem variantes com
// sufixo), entao e' uma TENTATIVA entre varias, e a resposta 404 da origem e' o que
// separa "slug errado" de "anime ausente": MEDIDO, `/busca`, `/search` e
// `/animes/busca/<t>` respondem 404 com HTML, enquanto o slug certo responde 200 com
// JSON.
function slugsDe(titulo) {
  const base = String(titulo || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:19|20)\d{2}\)/g, " ")
    .replace(/\b(?:dublado|dublada|legendado|legendada|completo|completa|tv|ova|especiais?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const saida = [];
  if (base) saida.push(base);
  // A origem usa o titulo de origem em varios casos; sem ele o slug pode nao casar.
  const cru = String(titulo || "").trim();
  if (cru && !saida.includes(cru)) saida.push(cru);
  return saida;
}

function numeroDe(item) {
  const texto = String((item && item.episodio) || "");
  const m = texto.match(/(\d{1,4})/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 5000 ? n : null;
}

// `404` e' a resposta que a origem da para um slug que nao existe, e nao sinal de queda:
// MEDIDO, os 404 vem com HTML de framework e os 200 vem com JSON. A distincao e' o que
// deixa a fonte tentar o proximo slug em vez de desistir.
async function episodiosDe(slug, tipo) {
  const url = `${API}/animes-${tipo}/${encodeURIComponent(slug)}/episodios`;
  let r = null;
  try {
    r = await pegarJson(url, { ms: MS, headers: CABECALHOS });
  } catch (_) {
    return null;
  }
  if (r.status === 404) return { inexistente: true, itens: [] };
  if (!r.ok) return { erro: `HTTP ${r.status || "?"}`, itens: [] };
  return { itens: Array.isArray(r.dados) ? r.dados : [] };
}

async function vivo(url) {
  let r = null;
  try {
    r = await pegar(url, { ms: 6e3, headers: { "User-Agent": UA, Referer: REFERER, Range: "bytes=0-2047" } });
  } catch (_) {
    return false;
  }
  if (r.status === 403 || r.status === 404 || r.status === 410 || r.status === 451) return false;
  if (r.status >= 500) return false;
  if (!r.ok && r.status !== 206) return false;
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  return !tipo.includes("text/html");
}

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const isTv = String(mediaType || "").toLowerCase() === "tv";
  if (!isTv) return [];
  const info = await tituloDe(tmdbId, mediaType, season, episode);
  if (!info || !info.titulo) return [];
  const temporada = Number(season) > 0 ? Number(season) : 1;
  const numero = Number(episode) > 0 ? Number(episode) : 1;

  const pedidos = [...new Set([info.titulo, info.original].filter(Boolean).map((t) => String(t).trim()))];
  const slugs = [];
  for (const p of pedidos) for (const s of slugsDe(p)) if (s && !slugs.includes(s)) slugs.push(s);
  if (!slugs.length) return [];

  // Legendado primeiro: a lista e' maior e o episode continua mais completo. O dublado
  // entra como segunda opcao — uma fonte que so oferece dublado nao pode ser a unica via.
  for (const tipo of ["legendados", "dublados"]) {
    for (const slug of slugs) {
      const r = await episodiosDe(slug, tipo);
      if (!r || r.erro) continue;
      if (!r.itens.length) continue;
      const alvo = r.itens.find((item) => numeroDe(item) === numero);
      if (!alvo) continue;
      const url = String(alvo.link_video || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      // A prova de vida e' o que separa "a lista tem o episodio" de "o video existe": o
      // `link_video` pode estar no JSON e o arquivo ja ter saido do CDN.
      if (!await vivo(url)) continue;
      const dublado = tipo === "dublados" || /dublad/i.test(String(alvo.tipo || ""));
      // A lista tem UM episodio por linha: a origem nao oferece tiers alternativos para o
      // mesmo episodio, entao uma linha e' a resposta completa e correta.
      return [
        apresenta({
          sigla: SIGLA,
          url,
          qualidade: extractQuality(url),
          titulo: info.titulo,
          ano: info.ano,
          temporada,
          episodio: numero,
          idioma: dublado ? "Dublado" : "Legendado",
          headers: { "User-Agent": UA, Referer: REFERER }
        })
      ];
    }
  }
  return [];
};