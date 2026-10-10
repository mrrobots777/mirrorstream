"use strict";

// Superfície Stremio do gateway (fora do plano — decisão do dono em 10/10/2026).
//
// O BeamUp não é um PaaS genérico: só publica addons Stremio, e o `beamup-lint`
// recusa o deploy no pre-flight com "is not a valid Stremio addon". O gateway
// passa a servir `/manifest.json` e `/stream/{type}:{id}[:{s}:{e}].json`.
//
// IMPORTANTE sobre o que isto NÃO é: o consumo real continua sendo
// `/resolve-batch` pelo plugin MirrorStream instalado no aparelho. Ninguém vai
// instalar este addon no Stremio. As duas rotas existem (a) para o gate da
// plataforma passar e (b) para o manifesto não mentir sobre `resources`.
//
// Sem dependência npm: os campos asertados em `manifesto` são exatamente os que
// `stremio-addon-linter/lib/linter.js` valida — `id`/`name` string, `version`
// semver, `resources`/`types`/`catalogs` array. Se o linter mudar de lá, muda
// aqui junto.
globalThis.MIRROR_QUALIDADE = "nunca";

const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");

const stremio = require("../stremio");
const { criaServidor } = require("../servidor");
const { criaResolve } = require("../resolve");
const { criaEstado } = require("../estado");
const { criaCache } = require("../cache");
const { criaMetricas } = require("../metricas");
const fontes = require("../fontes");

// ── unidade: manifesto ─────────────────────────────────────────────────────

test("manifesto tem todos os campos que o linter do Stremio valida", () => {
  const m = stremio.manifest;
  assert.equal(typeof m.id, "string", "manifest.id deve ser string");
  assert.equal(typeof m.name, "string", "manifest.name deve ser string");
  assert.match(m.version, /^\d+\.\d+\.\d+$/, "manifest.version deve ser semver");
  assert.ok(Array.isArray(m.resources), "manifest.resources deve ser array");
  assert.ok(Array.isArray(m.types), "manifest.types deve ser array");
  assert.ok(Array.isArray(m.catalogs), "manifest.catalogs deve ser array");
});

test("manifesto declara stream para movie e series, sem catálogo", () => {
  const m = stremio.manifest;
  assert.ok(m.resources.includes("stream"), "é addon de streams");
  assert.deepEqual(m.types, ["movie", "series"]);
  assert.deepEqual(m.catalogs, [], "não há catálogo para anunciar");
  assert.ok(Array.isArray(m.idPrefixes) && m.idPrefixes.length > 0);
});

// ── unidade: parse do caminho /stream/... ──────────────────────────────────

test("parseiaStream aceita id imdb simples", () => {
  assert.deepEqual(stremio.parseiaStream("movie:tt0133093"), {
    tipo: "movie", id: "tt0133093", temporada: null, episodio: null,
  });
});

test("parseiaStream separa temporada e episódio no fim do caminho de série", () => {
  // Stremio fala `series`, o gateway interno fala `tv` — o parse traduz,
  // porque é o `resolve` que recebe o resultado.
  assert.deepEqual(stremio.parseiaStream("series:tt0903747:1:1"), {
    tipo: "tv", id: "tt0903747", temporada: 1, episodio: 1,
  });
});

test("parseiaStream sobrevive a id com dois-pontos dentro (tmdb:603)", () => {
  // É o caso que quebra um `split(':')` ingênuo: o id tem próprio dois-pontos.
  assert.deepEqual(stremio.parseiaStream("movie:tmdb:603"), {
    tipo: "movie", id: "tmdb:603", temporada: null, episodio: null,
  });
  assert.deepEqual(stremio.parseiaStream("series:tmdb:1234:2:5"), {
    tipo: "tv", id: "tmdb:1234", temporada: 2, episodio: 5,
  });
});

test("parseiaStream devolve null para tipo que não é movie nem series", () => {
  assert.equal(stremio.parseiaStream("serie:tt0133093"), null);
  assert.equal(stremio.parseiaStream("anime:tt0133093"), null);
  assert.equal(stremio.parseiaStream(""), null);
  assert.equal(stremio.parseiaStream("movie"), null);
});

// ── unidade: item do gateway → item Stremio ────────────────────────────────

test("paraStremio move headers para behaviorHints.proxyHeaders.request", () => {
  // O Stremio lê header de play via behaviorHints.proxyHeaders, não como
  // `headers` solto no item — é assim que o relay do Nuvio/RTD toca o CDN.
  const saida = stremio.paraStremio({
    url: "https://cdn.example/v.mp4",
    name: "MirrorStream 720p",
    title: "Dublado · RTD",
    headers: { Referer: "https://redetoons.tv/", "User-Agent": "UA/1.0" },
    behaviorHints: { bingeGroup: "mirrorstream:rtd" },
  });
  assert.equal(saida.url, "https://cdn.example/v.mp4");
  assert.equal(saida.name, "MirrorStream 720p");
  assert.equal(saida.title, "Dublado · RTD");
  assert.deepEqual(saida.behaviorHints.proxyHeaders.request, {
    Referer: "https://redetoons.tv/", "User-Agent": "UA/1.0",
  });
});

test("paraStremio preserva o bingeGroup que o gateway já calculou", () => {
  const saida = stremio.paraStremio({ url: "u", behaviorHints: { bingeGroup: "mirrorstream:spc" } });
  assert.equal(saida.behaviorHints.bingeGroup, "mirrorstream:spc");
});

test("paraStremio tolera item sem headers e sem behaviorHints", () => {
  const saida = stremio.paraStremio({ url: "u", name: "n" });
  assert.equal(saida.url, "u");
  assert.ok(!("headers" in saida), "headers solto não é campo Stremio");
  assert.equal(saida.behaviorHints.proxyHeaders, undefined);
});

test("paraStremio descarta item sem url (Stremio descarta stream sem url)", () => {
  assert.equal(stremio.paraStremio({ name: "sem url" }), null);
});

// ── integração: rotas no servidor ──────────────────────────────────────────

let chamadas = 0;
const CATALOGO = new Set(["tt0133093", "tmdb:603", "tt0903747"]);
const chamaFonte = async (chave, r) => {
  chamadas++;
  if (!CATALOGO.has(r.id)) return [];
  return [{
    url: "https://cdn.example/v.mp4",
    name: "MirrorStream 720p",
    title: "Dublado · RTD",
    headers: { Referer: "https://redetoons.tv/" },
    behaviorHints: { bingeGroup: `mirrorstream:${chave}` },
  }];
};

let servidor, base;

before(async () => {
  fontes.carrega();
  const resolve = criaResolve({
    fontes, estado: criaEstado(), cache: criaCache(), metricas: criaMetricas(),
    orcaMs: 6000, chamaFonte,
  });
  servidor = criaServidor({ resolve, fontes, estado: criaEstado(), cache: criaCache(), metricas: criaMetricas() });
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  await new Promise((res) => servidor.close(res));
});

test("GET /manifest.json responde 200 com CORS e o manifesto", async () => {
  const r = await fetch(`${base}/manifest.json`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*", "erro também precisa de CORS");
  assert.match(r.headers.get("content-type"), /application\/json/);
  const b = await r.json();
  assert.equal(typeof b.id, "string");
  assert.ok(b.resources.includes("stream"));
});

test("GET /stream/movie:tt0133093.json devolve streams no formato Stremio", async () => {
  const r = await fetch(`${base}/stream/movie:tt0133093.json`);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.ok(Array.isArray(b.streams), "corpo é { streams }");
  assert.equal(b.streams.length, 1);
  assert.equal(b.streams[0].url, "https://cdn.example/v.mp4");
  assert.match(b.streams[0].behaviorHints.bingeGroup, /^mirrorstream:\w+$/, "bingeGroup vem do gateway");
  assert.deepEqual(b.streams[0].behaviorHints.proxyHeaders.request, { Referer: "https://redetoons.tv/" });
  assert.ok(!("headers" in b.streams[0]), "headers solto é forma do plugin, não do Stremio");
});

test("GET /stream/series:tt0903747:1:1.json repassa temporada e episódio ao resolve", async () => {
  const r = await fetch(`${base}/stream/series:tt0903747:1:1.json`);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.ok(Array.isArray(b.streams));
});

test("título sem fonte nenhuma é 200 com streams [] (igual /resolve-batch)", async () => {
  const r = await fetch(`${base}/stream/movie:tt9999999.json`);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).streams, []);
});

test("tipo que não é movie nem series é 400 com CORS", async () => {
  const r = await fetch(`${base}/stream/anime:tt0133093.json`);
  assert.equal(r.status, 400);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
});

test("método não-GET em /manifest.json é 405 e OPTIONS é 204", async () => {
  assert.equal((await fetch(`${base}/manifest.json`, { method: "POST" })).status, 405);
  const o = await fetch(`${base}/manifest.json`, { method: "OPTIONS" });
  assert.equal(o.status, 204);
  assert.equal(o.headers.get("access-control-allow-origin"), "*");
});

test("rotas antigas continuam intactas (regressão)", async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/resolve-batch?id=tt0133093&type=movie`)).status, 200);
  assert.equal((await fetch(`${base}/nada`)).status, 404);
});
