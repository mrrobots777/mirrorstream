const { pegar, pegarJson } = require("../../lib/http");
const { extractQuality } = require("../../lib/quality");
const { apresenta } = require("../../lib/apresentacao");
const { tituloDe } = require("../../lib/tmdb");
const { UA } = require("../../lib/ua");
const { TETO_CORPO_BYTES } = require("../../core/sandbox");

const INDICE = "https://redetoonstv.win/api/catalog-index";
const PLAY = "https://redetoonstv.win/api/play-link";
const REFERER = "https://redetoons.win/";
const SIGLA = "RTD";
const CONTRATO = 3;
const MS = 8e3;
const PEDIDO = { Referer: REFERER, "User-Agent": UA };

// MEDIDO 02/10/2026: ver `src/lib/id-de-conteudo.js`. O `replace(/[^0-9]/g, "")` de antes
// transformava `tt0133093` (The Matrix) em `0133093`, que o TMDB resolve como "Strings" (2012).
const { idDe } = require("../../lib/id-de-conteudo");
const { tmdbIdDe } = require("../../lib/tmdb");

async function indice() {
  const r = await pegarJson(INDICE, { ms: MS, headers: PEDIDO });
  if (r.status === 404) return null;
  if (!r.ok || !r.dados) throw new Error(`rtd indice HTTP ${r.status || "?"}`);
  const p = r.dados.payload || {};
  const filmes = Array.isArray(p.movies) ? p.movies : Array.isArray(p.movie) ? p.movie : null;
  const series = Array.isArray(p.tv) ? p.tv : null;
  if (!filmes || !series) throw new Error("rtd indice invalido");
  return { movie: new Set(filmes.map(Number)), tv: new Set(series.map(Number)) };
}

async function drena(resposta) {
  const tipo = String(resposta.headers.get("content-type") || "").toLowerCase();
  const comprimento = Number(resposta.headers.get("content-length") || 0);
  const pequeno = resposta.status === 206 || (comprimento > 0 && comprimento <= TETO_CORPO_BYTES) || (!comprimento && tipo.startsWith("text/"));
  if (!pequeno) return "";
  try {
    return await resposta.text();
  } catch (_) {
    return "";
  }
}

async function provaDeVida(url) {
  let r = null;
  try {
    r = await pegar(url, { ms: 5e3, headers: { Range: "bytes=0-2047", Referer: REFERER, "User-Agent": UA } });
  } catch (_) {
    return true;
  }
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  await drena(r);
  if (r.status === 403 || r.status === 404 || r.status === 410 || r.status === 451 || r.status >= 500) return false;
  if (tipo.includes("text/html")) return false;
  return true;
}

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const isTv = String(mediaType || "").toLowerCase() === "tv";
  // MEDIDO 02/10/2026: o id do caminho real do dono e' IMDb (`tt0133093`), porque o usuario
  // abre um vod do Cinemeta. Antes, virava `0133093` e a fonte consultava "Strings" (2012).
  const id = await tmdbIdDe(tmdbId, isTv);
  if (!id) return [];
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  let portao = null;
  try {
    portao = await indice();
  } catch (_) {
    portao = null;
  }
  if (portao && !(isTv ? portao.tv : portao.movie).has(Number(id))) return [];
  const params = new URLSearchParams({ contract: String(CONTRATO), tmdbId: id, type: isTv ? "tv" : "movie" });
  if (isTv) {
    params.set("season", String(s));
    params.set("episode", String(e));
  }
  const r = await pegarJson(`${PLAY}?${params.toString()}`, { ms: MS, headers: PEDIDO });
  if (r.status === 403) throw new Error("rtd bloqueado: HTTP 403 no play-link");
  if (r.status === 404) return [];
  if (!r.ok || !r.dados) throw new Error(`rtd HTTP ${r.status || "?"} em play-link`);
  const dados = r.dados;
  if (dados.missing) return [];
  // O titulo canonico vem do TMDB (memoizado). E o que faz a linha 1 dizer o QUE E
  // em vez da sigla. O RTD nao depende do TMDB para funcionar, entao a falta da
  // chave nao pode derrubar a fonte: sem titulo, a linha 1 cai para a sigla.
  let info = null;
  try {
    info = await tituloDe(id, isTv ? "tv" : "movie", isTv ? s : null, isTv ? e : null);
  } catch (_) {
    info = null;
  }
  if (dados.error) throw new Error(`rtd recusou: ${String(dados.error).slice(0, 40)}`);
  if (dados.contract !== void 0 && Number(dados.contract) !== CONTRATO) return [];
  if (dados.type && (isTv ? "tv" : "movie") !== String(dados.type)) return [];
  const variantes = Array.isArray(dados.variants) ? dados.variants : [];
  const streams = [];
  const vistos = new Set();
  for (const v of variantes) {
    const url = v && typeof v.url === "string" ? v.url : "";
    if (!/^https?:\/\//i.test(url) || vistos.has(url)) continue;
    vistos.add(url);
    const rotulo = String(v.quality || "");
    const legendado = /leg|sub|orig|vose/i.test(rotulo) || dados.is_legendado === true;
    const idioma = legendado ? "Legendado" : "Dublado";
    const qualidade = extractQuality(url) || extractQuality(rotulo);
    if (!await provaDeVida(url)) continue;
    streams.push(apresenta({
      sigla: SIGLA,
      url,
      qualidade,
      idioma,
      titulo: (info && info.titulo) || dados.title,
      ano: info && info.ano,
      temporada: isTv ? s : null,
      episodio: isTv ? e : null,
      headers: { Referer: REFERER, "User-Agent": UA }
    }));
    if (streams.length >= 25) break;
  }
  return streams;
};
