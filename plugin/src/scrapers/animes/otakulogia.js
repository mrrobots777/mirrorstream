const { pegar } = require("../../lib/http");
const { tituloDe } = require("../../lib/tmdb");
const { matchVodTitle } = require("../../lib/match");
const { normalizeLoose } = require("../../lib/text");
const { extractQuality } = require("../../lib/quality");
const { apresenta } = require("../../lib/apresentacao");

const API = "https://api.otakulogia.com/graphql";
const SIGLA = "SHG";
const MS = 7000;
const MARCADOR = /\b(shippu?den|\d(?:st|nd|rd|th)\s+season|season\s*\d|s\d{1,2}\b|temporada\s*\d)/i;

function numeroDaTemporada(texto) {
  const m = String(texto || "").match(/(?:season|temporada)\s*(\d{1,2})|\bs(\d{1,2})\b/i);
  return m ? Number(m[1] || m[2]) : 0;
}

function ehContinuacao(titulo, pedido) {
  if (!MARCADOR.test(String(titulo || ""))) return false;
  const doTitulo = numeroDaTemporada(titulo);
  const doPedido = numeroDaTemporada(pedido);
  if (doTitulo && doPedido) return doTitulo !== doPedido;
  return !MARCADOR.test(String(pedido || ""));
}

function titulosDe(item) {
  const saida = [];
  if (!item) return saida;
  if (typeof item === "string") return [item];
  for (const campo of ["name", "slug", "title"]) {
    const v = item[campo];
    if (typeof v === "string" && v.trim()) saida.push(v.trim());
  }
  return saida;
}

const chaveTolerante = (t) => normalizeLoose(t).replace(/(.)\1+/g, "$1");

function candidatos(consulta, itens, serie, teto) {
  const pedido = String(consulta || "").trim();
  if (!pedido) return [];
  const lista = Array.isArray(itens) ? itens : [];
  const limpo = normalizeLoose(pedido);
  const chave = chaveTolerante(pedido);
  const iguais = lista.filter((item) =>
    titulosDe(item).some((titulo) => normalizeLoose(titulo) === limpo || chaveTolerante(titulo) === chave)
  );
  if (iguais.length) return iguais.slice(0, teto);
  const passa = lista.find((item) =>
    titulosDe(item).some((titulo) => !ehContinuacao(titulo, pedido) && matchVodTitle(titulo, pedido, serie))
  );
  return passa ? [passa] : [];
}

async function gql(query, variables) {
  const res = await pegar(API, {
    metodo: "POST",
    ms: MS,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    corpo: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`shg HTTP ${res.status}`);
  const corpo = await res.json();
  if (corpo.errors) throw new Error(`shg GraphQL: ${corpo.errors[0] && corpo.errors[0].message}`);
  return corpo.data || null;
}

async function busca(query) {
  const data = await gql(
    `query($input: SearchAnimesInput!) { searchAnimes(input: $input) { total items { name slug posterUrl upstreamCid } } }`,
    { input: { query } }
  );
  const itens = data && data.searchAnimes && data.searchAnimes.items;
  return Array.isArray(itens) ? itens : [];
}

async function detalhe(cid) {
  const data = await gql(
    `query($cid: Int!) { animeCatalogDetail(upstreamCid: $cid) { anime { name slug posterUrl synopsis } episodes { id title episodeNumber videoUrl videoUrlFhd videoUrlSd audioType thumbnailLarge } } }`,
    { cid }
  );
  return (data && data.animeCatalogDetail) || null;
}

function episodioDe(titulo) {
  const m = String(titulo || "").match(/T(\d+)\s+EP\.\s*(\d+)/);
  return m ? { temporada: Number(m[1]), numero: Number(m[2]) } : null;
}

function urlDe(ep) {
  return ep.videoUrlFhd || ep.videoUrl || ep.videoUrlSd || null;
}

function idiomaDe(audio) {
  const a = String(audio || "").toLowerCase();
  if (a.includes("dub")) return "Dublado";
  if (a.includes("leg") || a.includes("sub")) return "Legendado";
  return null;
}

function casaPedido(consulta, titulo, serie) {
  const pedido = String(consulta || "").trim();
  if (!pedido || !titulo) return false;
  if (normalizeLoose(titulo) === normalizeLoose(pedido)) return true;
  if (chaveTolerante(titulo) === chaveTolerante(pedido)) return true;
  return !ehContinuacao(titulo, pedido) && matchVodTitle(titulo, pedido, serie);
}

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const serie = String(mediaType || "").toLowerCase() === "tv";
  const info = await tituloDe(tmdbId, mediaType, season, episode);
  if (!info || !info.titulo) return [];

  const itens = await busca(info.titulo);
  if (!itens.length) return [];
  const alvos = candidatos(info.titulo, itens, serie, 3);
  if (!alvos.length) return [];

  const resultados = await Promise.allSettled(
    alvos.map((item) => (Number(item.upstreamCid) ? detalhe(Number(item.upstreamCid)) : null))
  );
  if (resultados.every((r) => r.status === "rejected")) throw resultados.find((r) => r.status === "rejected").reason;
  const detalhes = resultados.map((r) => (r.status === "fulfilled" ? r.value : null));
  const prontos = detalhes.filter((det, i) => {
    if (!det || !Array.isArray(det.episodes) || !det.episodes.length) return false;
    const nome = det.anime && det.anime.name ? det.anime.name : null;
    return casaPedido(info.titulo, nome || alvos[i].name, serie);
  });
  if (!prontos.length) return [];

  const episodios = prontos.flatMap((det) => det.episodes).filter((ep) => urlDe(ep));
  if (!episodios.length) return [];

  let alvosDeEpisodio;
  if (serie) {
    const sn = Number(season) > 0 ? Number(season) : 1;
    const en = Number(episode) > 0 ? Number(episode) : 1;
    alvosDeEpisodio = episodios.filter((ep) => {
      const p = episodioDe(ep.title);
      return p && p.temporada === sn && p.numero === en;
    });
  } else {
    alvosDeEpisodio = episodios.filter((ep) => {
      const p = episodioDe(ep.title);
      return p && p.temporada === 1 && p.numero === 1;
    });
    if (!alvosDeEpisodio.length) alvosDeEpisodio = episodios.slice(0, 1);
  }

  const vistos = new Set();
  const saida = [];
  for (const ep of alvosDeEpisodio) {
    const url = urlDe(ep);
    if (!url || vistos.has(url)) continue;
    vistos.add(url);
    saida.push(apresenta({
      sigla: SIGLA,
      url,
      qualidade: extractQuality(ep.title) || extractQuality(url),
      idioma: idiomaDe(ep.audioType),
      titulo: info.titulo,
      ano: info.ano,
      temporada: serie ? (Number(season) > 0 ? Number(season) : 1) : null,
      episodio: serie ? (Number(episode) > 0 ? Number(episode) : 1) : null
    }));
    if (saida.length >= 150) break;
  }
  return saida;
};
