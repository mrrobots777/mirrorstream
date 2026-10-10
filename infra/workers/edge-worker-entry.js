import cdn from "./mirror-cdn.js";
import spc from "../../plugin/src/scrapers/filmes/painel-space.js";
import blz from "../../plugin/src/scrapers/filmes/painel-blaze.js";
import ato from "../../plugin/src/scrapers/filmes/painel-autos.js";
import shg from "../../plugin/src/scrapers/animes/otakulogia.js";
import ron from "../../plugin/src/scrapers/animes/animesdigital.js";
import atb from "../../plugin/src/scrapers/animes/anitube.js";
import ise from "../../plugin/src/scrapers/animes/isekai.js";
import san from "../../plugin/src/scrapers/animes/superanimes.js";
import rtd from "../../plugin/src/scrapers/animes/redetoons.js";
import dgo from "../../plugin/src/scrapers/doramas/doramogo.js";

const FONTES = Object.freeze({ spc, blz, ato, shg, ron, atb, ise, san, rtd, dgo });
const MAX_STREAMS = 25;
const TTL_RESOLUCAO = 1800;
const MEMORIA = new Map();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function dadosDaUrl(url) {
  return {
    id: url.searchParams.get("id") || "",
    tipo: url.searchParams.get("type") || "movie",
    temporada: url.searchParams.has("season") ? Number(url.searchParams.get("season")) : null,
    episodio: url.searchParams.has("episode") ? Number(url.searchParams.get("episode")) : null
  };
}

function chaveDe(source, dados) {
  return `${source}|${dados.id}|${dados.tipo}|${dados.temporada}|${dados.episodio}`;
}

function urlRelay(request, stream) {
  const origem = typeof stream.url === "string" ? stream.url : stream.url && stream.url.url;
  if (!origem) return null;
  const ref = stream.referer || stream.referrer || stream.ref || "";
  const base = new URL(request.url).origin;
  return `${base}/proxy?media=1&url=${encodeURIComponent(origem)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`;
}

function preparaStreams(request, source, lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter((stream) => stream && urlRelay(request, stream))
    .slice(0, MAX_STREAMS)
    .map((stream) => ({
      ...stream,
      url: urlRelay(request, stream),
      name: "☁️ MirrorStream",
      provider: "☁️ MirrorStream",
      behaviorHints: {
        ...(stream.behaviorHints && typeof stream.behaviorHints === "object" ? stream.behaviorHints : {}),
        bingeGroup: `mirrorstream:${source}`
      }
    }));
}

async function lerCache(request) {
  try {
    return await Promise.race([
      caches.default.match(request),
      new Promise((resolve) => setTimeout(() => resolve(null), 800))
    ]);
  } catch (_) { return null; }
}

async function guardarCache(request, response, ctx) {
  try { ctx.waitUntil(caches.default.put(request, response.clone())); } catch (_) {}
}

async function resolverNaBorda(request, env, ctx) {
  const url = new URL(request.url);
  const source = String(url.searchParams.get("source") || env.MIRROR_SOURCE || "").toLowerCase();
  const fonte = FONTES[source];
  if (!fonte || typeof fonte.getStreams !== "function") return json({ error: "source not enabled" }, 400);
  const dados = dadosDaUrl(url);
  if (!/^[a-zA-Z0-9_-]{2,120}$/.test(dados.id)) return json({ error: "id required" }, 400);

  const chave = chaveDe(source, dados);
  const cacheKey = new Request(`${url.origin}/resolve-edge?source=${encodeURIComponent(source)}&id=${encodeURIComponent(dados.id)}&type=${encodeURIComponent(dados.tipo)}&season=${encodeURIComponent(dados.temporada ?? "-")}&episode=${encodeURIComponent(dados.episodio ?? "-")}`);
  const memoria = MEMORIA.get(chave);
  if (memoria && memoria.expira > Date.now()) return json({ streams: memoria.streams, source, cache: "HIT" }, 200, { "cache-control": `public, max-age=${TTL_RESOLUCAO}`, "x-mirror-resolution": "EDGE-MEMORY-HIT" });
  if (memoria) MEMORIA.delete(chave);

  const guardado = await lerCache(cacheKey);
  if (guardado) {
    try {
      const payload = await guardado.json();
      payload.cache = "HIT";
      return json(payload, 200, { "cache-control": `public, max-age=${TTL_RESOLUCAO}`, "x-mirror-resolution": "EDGE-HIT" });
    } catch (_) {
      const headers = new Headers(guardado.headers);
      headers.set("x-mirror-resolution", "EDGE-HIT");
      return new Response(guardado.body, { status: 200, headers });
    }
  }

  globalThis.TMDB_API_KEY = env.TMDB_API_KEY || globalThis.TMDB_API_KEY;
  globalThis.MIRROR_SPC_USER = env.SPC_USER || globalThis.MIRROR_SPC_USER;
  globalThis.MIRROR_SPC_PASS = env.SPC_PASS || globalThis.MIRROR_SPC_PASS;
  globalThis.MIRROR_BLZ_USER = env.BLZ_USER || globalThis.MIRROR_BLZ_USER;
  globalThis.MIRROR_BLZ_PASS = env.BLZ_PASS || globalThis.MIRROR_BLZ_PASS;
  globalThis.MIRROR_ATO_USER = env.ATO_USER || globalThis.MIRROR_ATO_USER;
  globalThis.MIRROR_ATO_PASS = env.ATO_PASS || globalThis.MIRROR_ATO_PASS;
  let lista;
  try {
    lista = await fonte.getStreams(dados.id, dados.tipo, dados.temporada, dados.episodio);
  } catch (erro) {
    return json({ error: "edge resolver failed", detail: String(erro && erro.message || erro).slice(0, 240) }, 502, { "cache-control": "no-store" });
  }
  const streams = preparaStreams(request, source, lista);
  const payload = { streams, source, cache: "MISS" };
  const resposta = json(payload, 200, { "cache-control": `public, max-age=${TTL_RESOLUCAO}`, "x-mirror-resolution": "EDGE-MISS" });
  MEMORIA.set(chave, { streams, expira: Date.now() + TTL_RESOLUCAO * 1000 });
  if (MEMORIA.size > 200) MEMORIA.delete(MEMORIA.keys().next().value);
  await guardarCache(cacheKey, resposta, ctx);
  return resposta;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/resolve-edge") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
      return resolverNaBorda(request, env, ctx);
    }
    return cdn.fetch(request, env, ctx);
  }
};
