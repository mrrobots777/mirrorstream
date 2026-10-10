"use strict";

// Orquestração do gateway (Task 6, spec §5/§6/§7/§9, casos 1-8 e 11 de §11).
// `chamaFonte` é a única coisa que varia entre os casos: o registro de fontes é
// o REAL do plugin (pincha a ORDEM à de `plugin/src/core/fontes`), e o relógio
// é injetado para o TTL não depender de tempo real.
//
// ANTES de tudo: sem isto o `qualificaLista` sonda vídeo de verdade e a suíte
// trava (plugin/src/lib/qualifica.js:135 lê globalThis.MIRROR_QUALIDADE).
globalThis.MIRROR_QUALIDADE = "nunca";

const test = require("node:test");
const { beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { criaResolve } = require("../resolve");
const { criaEstado } = require("../estado");
const { criaCache } = require("../cache");
const { criaMetricas } = require("../metricas");
const fontes = require("../fontes");
fontes.carrega();                          // registro REAL — a ORDEM vem do plugin

const req = { id: "tt0133093", tipo: "movie", temporada: null, episodio: null };
const reqTv = { id: "tt0903747", tipo: "tv", temporada: 1, episodio: 1 };

// Host de mídia REAL de cada fonte (plugin/src/core/politica.js,
// MEDIA_WORKER_POR_HOST): só host conhecido vira URL de relay, e a sigla do
// Worker tem de bater com a fonte — `cdn.example` ficaria sem reescrita.
const HOSTES = {
  shg: "nsrv.classotaku.app",
  ron: "cdn-s01.mywallpaper-4k-image.net",
  atb: "cdn-sv01.maximaimg.online",
  blz: "kakito.xyz",
  spc: "telaplay93.top",
  ise: "anitubehd2.dalayqnwpo.lol",
  san: "cdn.animestvs.org",
  rtd: "redetoons.win",
  dgo: "forks-doramas.madfirebox.shop",
};
const streamDe = (chave) => ({ url: `https://${HOSTES[chave]}/${chave}.mp4`, quality: "720p", title: "Dublado" });

// R4 — tudo que vaza entre casos é declarado aqui e zerado no beforeEach: os
// casos contam chamadas por consulta, e um cache compartilhado viraria HIT.
let chamadas, estado, cache, metricas, resolve, t, agora;

const chamaFontePadrao = async (chave) => { chamadas.push(chave); return [streamDe(chave)]; };

beforeEach(() => {
  chamadas = [];
  t = 0; agora = () => t;
  estado = criaEstado({ agora });
  cache = criaCache({ agora });
  metricas = criaMetricas();
  resolve = novoResolve(chamaFontePadrao);
});

function novoResolve(fn, orcaMs = 6000) {
  return criaResolve({ fontes, estado, cache, metricas, orcaMs, agora, chamaFonte: fn });
}

test("ordem de prioridade: preferida → saudável → ORDEM (spec §5, caso 1)", async () => {
  // R14 — o `chamadas` é o do módulo (zerado no beforeEach), nunca um local:
  // o padrão empurra nele, e um array local ficaria sempre vazio.
  const r = await resolve({ ...reqTv, preferida: "mirrorstream:spc" });
  assert.deepEqual(chamadas, ["spc"]);
  assert.deepEqual(r.fontes, ["spc"]);
});

test("preferida inexistente ou de tipo incompatível é ignorada (spec §5, caso 3)", async () => {
  const r = await resolve({ ...reqTv, preferida: "mirrorstream:naoexiste" });
  assert.ok(r.fontes.length > 1, "sem preferida válida cai na onda normal");
  const r2 = await resolve({ ...req, preferida: "mirrorstream:ise" });   // ise é tv-only
  assert.ok(r2.fontes.length > 1, "preferida de tipo incompatível é ignorada");
});

test("busca padrão consulta as nove fontes ativas elegíveis para TV", async () => {
  const r = await resolve(reqTv);
  const esperado = fontes.elegiveis("tv").map((f) => f.chave);
  assert.equal(esperado.length, 9, "o registro atual tem nove fontes ativas para TV");
  assert.deepEqual(r.fontes, esperado, "é a ORDEM do registro, não rodízio");
});

test("busca de filme consulta todas as sete fontes compatíveis", async () => {
  const r = await resolve(req);
  const esperado = fontes.elegiveis("movie").map((f) => f.chave);
  assert.equal(esperado.length, 7, "duas fontes ativas são exclusivas de anime");
  assert.deepEqual(r.fontes, esperado);
});

test("fonte que responde após 700 ms entra na resposta completa", async () => {
  const esperado = fontes.elegiveis("tv").map((f) => f.chave);
  const comDgoLenta = async (chave) => {
    chamadas.push(chave);
    if (chave === "dgo") {
      await new Promise((res) => setTimeout(res, 850));
      return [{ ...streamDe(chave), quality: "480p", title: "Legendado" }];
    }
    return [streamDe(chave)];
  };
  const r = await novoResolve(comDgoLenta, 2000)(reqTv);
  assert.deepEqual(r.fontes, esperado);
  assert.equal(r.cache, "MISS");
  assert.ok(r.streams.some((s) => s.behaviorHints.bingeGroup === "mirrorstream:dgo"),
            "o stream da última fonte não foi omitido após a antiga janela de graça");
  assert.ok(r.streams.some((s) => s.quality === "480p"));
});

test("resposta vazia só é marcada depois de consultar todas as fontes elegíveis", async () => {
  const sempreVazio = async (chave) => { chamadas.push(chave); return []; };
  const esperado = fontes.elegiveis("tv").map((f) => f.chave);
  const r = await novoResolve(sempreVazio)(reqTv);
  assert.deepEqual(chamadas, esperado);
  assert.deepEqual(r.fontes, esperado);
  assert.deepEqual(r.streams, []);
});

test("preferida vazia aciona reserva de 2 (spec §5)", async () => {
  const semBlz = async (chave) => { chamadas.push(chave); return chave === "blz" ? [] : [streamDe(chave)]; };
  const r = await novoResolve(semBlz)({ ...reqTv, preferida: "mirrorstream:blz" });
  assert.equal(r.fontes.length, 3);        // 1 preferida + 2 reserva
  assert.deepEqual(r.fontes.slice(0, 1), ["blz"]);
  assert.ok(r.streams.length > 0, "as reservas responderam");
});

test("cache completo devolve HIT sem chamar scraper nenhum (spec §11 caso 4)", async () => {
  const r1 = await resolve(req);                       // MISS
  assert.equal(r1.cache, "MISS");
  const chamadasApos = chamadas.length;
  const r2 = await resolve(req);
  assert.equal(r2.cache, "HIT");
  assert.deepEqual(r2.fontes, []);
  assert.equal(chamadas.length, chamadasApos, "HIT não chama scraper nenhum");
});

test("resultado vazio é NEGATIVO na chamada seguinte (spec §11 caso 5)", async () => {
  const sempreVazio = async (chave) => { chamadas.push(chave); return []; };
  const r = await novoResolve(sempreVazio)(req);
  assert.equal(r.cache, "MISS"); assert.deepEqual(r.streams, []);
  const r2 = await novoResolve(sempreVazio)(req);
  assert.equal(r2.cache, "NEGATIVO");
});

test("duas chamadas idênticas simultâneas executam cada fonte uma vez (spec §11 caso 6)", async () => {
  const [a, b] = await Promise.all([resolve(req), resolve(req)]);
  assert.equal(chamadas.length, fontes.elegiveis(req.tipo).length);
  assert.deepEqual(a, b);
});

test("além do orçamento responde PARCIAL e regrava o cache completo depois (spec §11 caso 7)", async () => {
  // Todas as fontes elegíveis da solicitação de filme são disparadas; a spc
  // demora orcaMs + 50 (orcaMs = 100 aqui) e devolve 1080p, qualidade distinta
  // que prova a regravação COMPLETA em background, não só a extensão do TTL.
  const chama = async (chave) => {
    chamadas.push(chave);
    if (chave === "spc") {
      await new Promise((res) => setTimeout(res, 150));
      return [{ ...streamDe(chave), quality: "1080p" }];
    }
    return [streamDe(chave)];
  };
  const r = await novoResolve(chama, 100)(req);
  assert.equal(r.cache, "PARCIAL");
  await new Promise((res) => setTimeout(res, 250));   // a tarefa lenta termina e o cache é regravado
  // Discriminador da regravação em background: o parcial do foreground tem TTL
  // 15000 e o completo tem 300000. Passado o TTL do parcial, o HIT só existe
  // se o background tiver regravado — e o stream do spc prova que o guardado é
  // o resultado COMPLETO, não um parcial com TTL maior.
  t += 15001;
  const r2 = await novoResolve(chama, 100)(req);
  assert.equal(r2.cache, "HIT");
  assert.ok(r2.streams.some((s) => s.behaviorHints.bingeGroup === "mirrorstream:spc"),
            "o cache completo contém o stream que a fonte lenta devolveu tarde");
});

test("uma fonte que rejeita não derruba as outras (spec §9, Review Focus 5)", async () => {
  const comBlzFora = async (chave) => {
    chamadas.push(chave);
    if (chave === "blz") throw new Error("painel fora");
    return [streamDe(chave)];
  };
  const r = await novoResolve(comBlzFora)(req);
  assert.ok(r.streams.length > 0, "as fontes saudáveis responderam");
  assert.ok(r.fontes.includes("blz"), "blz foi consultada e consta na resposta");
  assert.ok(r.streams.every((s) => !/mirrorstream:blz$/.test(s.behaviorHints.bingeGroup)),
            "nenhum stream veio da fonte que falhou");
});

test("tudo stream devolvido tem bingeGroup e URL no relay (Review Focus 4)", async () => {
  const r = await resolve({ id: "tt5", tipo: "movie", temporada: null, episodio: null });
  assert.ok(r.streams.length > 0);
  for (const s of r.streams) {
    assert.match(s.behaviorHints.bingeGroup, /^mirrorstream:[a-z]+$/);
    assert.match(s.url, /workers\.dev\/proxy\?media=1&url=/);   // reescrito por agruparStreams
  }
});

test("fonte em cooldown sai da seleção e aparece no total (spec §7, caso 8)", async () => {
  estado.falha("shg"); estado.falha("shg"); estado.falha("shg");   // 3 falhas → cooldown de 60 s
  assert.ok(estado.emCooldown("shg"));
  const r = await resolve(req);
  assert.ok(!r.fontes.includes("shg"));
});

test("falha TOTAL não vira cache negativo (spec §9: resposta inválida não é guardada)", async () => {
  const tudoFora = async (chave) => { chamadas.push(chave); throw new Error("painel fora"); };
  const r = await novoResolve(tudoFora)(req);
  assert.deepEqual(r.streams, []);
  assert.equal(r.cache, "MISS");            // não NEGATIVO: nada foi guardado
  assert.equal(cache.tamanho(), 0, "nada foi guardado durante o outage");
  const chamadasApos = chamadas.length;
  const r2 = await novoResolve(tudoFora)(req);
  assert.equal(r2.cache, "MISS", "a segunda chamada refaz, sem herdar o outage por 30 s");
  assert.ok(chamadas.length > chamadasApos, "a segunda chamada consultou as fontes de novo");
});

// Rótulo minúsculo na fronteira da métrica, valor maiúsculo no corpo da resposta.
test("métrica de resolve usa rótulo minúsculo; a resposta, o valor maiúsculo (brief)", async () => {
  await resolve(req);                        // MISS
  await resolve(req);                        // HIT
  const texto = metricas.render({ fontes: { total: 0, ativas: 0, em_cooldown: 0 }, cache: { positivo: 0, negativo: 0 } });
  assert.match(texto, /gateway_resolve_total\{cache="miss"\} 1/);
  assert.match(texto, /gateway_resolve_total\{cache="hit"\} 1/);
});

// ── a mensagem da falha chega ao log ───────────────────────────────────────
//
// Existia porque o 403 do `rtd` no BeamUp ficou INVISÍVEL: `catch (_) { errou =
// true }` guardava o fato de ter falhado (métrica `erro`, cooldown) mas jogava a
// mensagem fora, então `beamup logs` mostrava só "a fonte errou" — nunca se era
// 403 do Cloudflare, timeout de 8 s ou JSON inválido. Um operador não consegue
// decidir nada com "erro"; precisa do motivo. Instrumentação, não mudança de
// comportamento: a resposta ao cliente é idêntica antes e depois.
async function capturaLog(fn) {
  const linhas = [];
  const original = console.error;
  console.error = (...args) => linhas.push(args.map(String).join(" "));
  try { await fn(); } finally { console.error = original; }
  return linhas;
}

test("erro da fonte registra a mensagem REAL — o log tem de dizer POR QUE falhou", async () => {
  const vaiErro = async (chave) => { chamadas.push(chave); throw new Error("rtd indice HTTP 403"); };
  const linhas = await capturaLog(() => novoResolve(vaiErro)(req));
  const daRtd = linhas.filter((l) => l.includes("rtd"));
  assert.ok(
    daRtd.some((l) => l.includes("403")),
    `esperava a mensagem 403 atribuída ao rtd; veio: ${JSON.stringify(linhas)}`
  );
});

test("rejeição que não é Error também loga a fonte (não vira undefined)", async () => {
  const vaiErro = async (chave) => { chamadas.push(chave); return Promise.reject("painel fora"); };
  const linhas = await capturaLog(() => novoResolve(vaiErro)(req));
  assert.ok(
    linhas.some((l) => l.includes("shg") && l.includes("painel fora")),
    `esperava a fonte e a causa no log; veio: ${JSON.stringify(linhas)}`
  );
});

// ── mesmo com orçamento zerado, não há uma segunda onda na busca padrão ────
// Todas as fontes elegíveis já foram disparadas na onda principal. O teste
// impede regressão para chamadas duplicadas/inúteis após esgotar o orçamento.
test("sem orçamento restante nenhuma fonte é disparada uma segunda vez", async () => {
  const lenta = async (chave) => { chamadas.push(chave); return new Promise(() => {}); };
  const r = await novoResolve(lenta, 100)(req);
  assert.deepEqual(r.streams, [], "sem orçamento não há stream");
  assert.equal(chamadas.length, fontes.elegiveis(req.tipo).length);
  assert.equal(new Set(chamadas).size, chamadas.length, "nenhuma fonte foi consultada duas vezes");
});
