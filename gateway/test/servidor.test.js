"use strict";

// Servidor HTTP do gateway (Task 7, spec §4, §11 casos 9 e 10): as três rotas,
// a validação pré-scraper e os cabeçalhos. A suíte não toca em rede nenhuma —
// o `chamaFonte` é injetado no `criaResolve` e o servidor nasce na porta 0 em
// `before()`.
//
// ANTES de tudo: sem isto o `qualificaLista` sonda vídeo de verdade e a suíte
// trava (plugin/src/lib/qualifica.js:135 lê globalThis.MIRROR_QUALIDADE).
globalThis.MIRROR_QUALIDADE = "nunca";

const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { criaServidor } = require("../servidor");
const { criaResolve } = require("../resolve");
const { criaEstado } = require("../estado");
const { criaCache } = require("../cache");
const { criaMetricas } = require("../metricas");
const fontes = require("../fontes");

// R15 — o contador é do MÓDULO e zera no beforeEach: um `let chamadas` local
// dentro do teste ficaria 0 para sempre e a asserção "validação é pré-scraper"
// passaria vacuamente — justamente a asserção que prova que a validação vem
// antes de qualquer scraper. O fixture empurra nele.
let chamadas = 0;
let visto = null;                          // última requisição recebida pelo chamaFonte

// O "catálogo" desta fonte fake: só o que ela tem. `tt9` e `a` não estão — é
// o caso de resultado vazio (spec §4: 200 com `streams: []`, §11 caso 9).
const CATALOGO = new Set(["tmdb:603", "tt0903747:1:1", "tt0133093", "tt1"]);
const chamaFonte = async (chave, r) => {
  chamadas++;
  visto = r;
  if (!CATALOGO.has(r.id)) return [];
  return [{ url: "https://cdn.example/v.mp4", quality: "720p", __mirrorSource: chave }];
};

const estado = criaEstado();
const cache = criaCache();
const metricas = criaMetricas();
const apis = { resolve: null, fontes, estado, cache, metricas };   // resolve montado em before()

let servidor, base;

before(async () => {
  fontes.carrega();                        // registro REAL — elegiveis() precisa dele
  apis.resolve = criaResolve({ fontes, estado, cache, metricas, orcaMs: 6000, chamaFonte });
  servidor = criaServidor(apis);
  await new Promise((res) => servidor.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  await new Promise((res) => servidor.close(res));
});

beforeEach(() => {
  chamadas = 0;
  visto = null;
});

test("GET /resolve-batch valida id e type antes de tocar em qualquer fonte (caso 9)", async () => {
  const r400 = await fetch(`${base}/resolve-batch?id=..&type=movie`);
  assert.equal(r400.status, 400);                // id ".." não passa no regex
  assert.equal(chamadas, 0, "validação é pré-scraper");
  const rTipo = await fetch(`${base}/resolve-batch?id=tt1&type=serie`);
  assert.equal(rTipo.status, 400);
  assert.equal(chamadas, 0);
});

test("id com dois-pontos passa (spec §4 — tmdb:603 e tt0903747:1:1)", async () => {
  for (const id of ["tmdb:603", "tt0903747:1:1", "tt0133093"]) {
    const r = await fetch(`${base}/resolve-batch?id=${encodeURIComponent(id)}&type=movie`);
    assert.equal(r.status, 200, id);
  }
});

test("season/episode em '-' não vira NaN nem erro (Review Focus 2)", async () => {
  const r = await fetch(`${base}/resolve-batch?id=tt1&type=movie&season=-&episode=-`);
  assert.equal(r.status, 200);
  assert.equal(visto.temporada, null, "virou null, não NaN");
  assert.equal(visto.episodio, null);
});

test("resposta vazia é 200 com streams [] (spec §4)", async () => {
  const r = await fetch(`${base}/resolve-batch?id=tt9&type=movie`);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).streams, []);
});

test("método não-GET é 405 e OPTIONS é 204, ambos com CORS (Review Focus 3)", async () => {
  const r = await fetch(`${base}/resolve-batch?id=x&type=movie`, { method: "POST" });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("access-control-allow-origin"), "*", "405 também precisa de CORS");
  const o = await fetch(`${base}/resolve-batch`, { method: "OPTIONS" });
  assert.equal(o.status, 204);
  assert.equal(o.headers.get("access-control-allow-origin"), "*");
});

test("as três rotas mandam Access-Control-Allow-Origin: * (Review Focus 3)", async () => {
  for (const p of ["/health", "/metrics", "/resolve-batch?id=a&type=movie"]) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.headers.get("access-control-allow-origin"), "*", p);
  }
});

test("rota desconhecida é 404", async () => {
  assert.equal((await fetch(`${base}/nada`)).status, 404);
});

test("erros 400 e 404 também mandam Access-Control-Allow-Origin: * (spec §4)", async () => {
  // Um 400 bloqueado por CORS aparece no aparelho como falha de rede, não como
  // erro de validação — é por isso que o spec exige o cabeçalho nos ERROS.
  const r400 = await fetch(`${base}/resolve-batch?id=..&type=movie`);
  assert.equal(r400.status, 400);
  assert.equal(r400.headers.get("access-control-allow-origin"), "*", "400");
  const r404 = await fetch(`${base}/nada`);
  assert.equal(r404.status, 404);
  assert.equal(r404.headers.get("access-control-allow-origin"), "*", "404");
});

test("/health vem com no-store e os contadores certos (spec §4, caso 10)", async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.ok(b.fontes.total >= b.fontes.ativas, "total nunca pode ficar abaixo de ativas");
  assert.equal(b.fontes.em_cooldown <= b.fontes.ativas, true, "em_cooldown é subconjunto de ativas");
  assert.equal(typeof b.versao, "string");
  assert.ok(b.uptime_s >= 0);
  assert.ok(b.cache.positivo >= 0 && b.cache.negativo >= 0);
  // Forma EXATA do contrato (brief/spec §4): uma chave a mais ou faltando
  // reprova aqui — os asserts de cima sozinhos deixariam uma chave extra passar.
  // Os números vêm da resposta, para o teste valer com qualquer contagem.
  assert.deepStrictEqual(b, {
    ok: true,
    versao: "1.0.0",
    uptime_s: b.uptime_s,
    fontes: { total: b.fontes.total, ativas: b.fontes.ativas, em_cooldown: b.fontes.em_cooldown },
    cache: { positivo: b.cache.positivo, negativo: b.cache.negativo },
  });
});

test("/metrics vem no formato Prometheus e com no-store (caso 10)", async () => {
  const r = await fetch(`${base}/metrics`);
  assert.match(r.headers.get("content-type"), /^text\/plain; version=0\.0\.4/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(await r.text(), /^gateway_up 1$/m);
});

test("exceção dentro de resolve devolve 500 JSON, não stack (spec §4)", async () => {
  // servidor montado com um resolve que lança — mesmo helper do setup
  const quebrado = criaServidor({ ...apis, resolve: async () => { throw new Error("estouro"); } });
  await new Promise((res) => quebrado.listen(0, res));
  try {
    const r = await fetch(`http://127.0.0.1:${quebrado.address().port}/resolve-batch?id=tmdb:603&type=movie`);
    assert.equal(r.status, 500);
    const b = await r.json();
    assert.equal(b.erro, "interno");
    assert.ok(!("stack" in b), "stack nunca vaza para o cliente");
    assert.equal(r.headers.get("access-control-allow-origin"), "*", "erro também precisa de CORS");
  } finally {
    await new Promise((res) => quebrado.close(res));
  }
});
