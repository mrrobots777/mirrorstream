"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const politica = require("../src/core/politica");
const { mediaWorkerDe, chaveResolucao, resolveBatchUrl } = politica;
const { agruparStreams } = require("../src/lib/agregador");

test("mediaWorkerDe roteia apenas hosts conhecidos para o worker da própria fonte", () => {
  const url = "https://kakito.xyz/movie/USUARIO-DO-PAINEL/SENHA-DO-PAINEL/11197.mp4";
  assert.match(mediaWorkerDe(url, "blz"), /^https:\/\/mirror-blz\.mr-caiomendonca\.workers\.dev\/proxy\?media=1&url=/);
  assert.equal(mediaWorkerDe(url, "spc"), null);
  assert.equal(mediaWorkerDe("https://host-desconhecido.invalid/video.mp4", "blz"), null);
});

test("agregador troca mídia BLZ pela borda e preserva bingeGroup", () => {
  const [stream] = agruparStreams([[
    { url: "https://kakito.xyz/movie/USUARIO-DO-PAINEL/SENHA-DO-PAINEL/11197.mp4", quality: "1080p", title: "Dublado", __mirrorSource: "blz" }
  ]]);
  assert.match(stream.url, /^https:\/\/mirror-blz\.mr-caiomendonca\.workers\.dev\/proxy\?media=1&url=/);
  assert.equal(stream.behaviorHints.bingeGroup, "mirrorstream:blz");
});

test("agregador não altera mídia de fonte sem Worker registrado", () => {
  const [stream] = agruparStreams([[
    { url: "https://cdn.example.invalid/video.mp4", quality: "720p", __mirrorSource: "shg" }
  ]]);
  assert.equal(stream.url, "https://cdn.example.invalid/video.mp4");
});

test("hosts auditados de anime e dorama apontam para a fonte correspondente", () => {
  const casos = [
    ["https://nsrv.classotaku.app/file/classgg/2121/1.mp4", "shg", "mirror-shg"],
    ["https://cdn-sv01.maximaimg.online/stream/b/bleach-dublado/01.mp4/index.m3u8", "atb", "mirror-atb"],
    ["https://cdn-s01.mywallpaper-4k-image.net/stream/sv/b/bleach/01.mp4/index.m3u8", "ron", "mirror-ron"],
    ["https://anitubehd2.dalayqnwpo.lol/31779.mp4", "ise", "mirror-ise"],
    ["https://cdn.animestvs.org/video/bleach/01.mp4", "san", "mirror-san"],
    ["https://redetoonstv.win/stream/bleach/01.m3u8", "rtd", "mirror-rtd"],
    ["https://forks-doramas.madfirebox.shop/P/pousando/01/stream.m3u8", "dgo", "mirror-dgo"]
  ];
  for (const [url, fonte, worker] of casos) {
    assert.ok(mediaWorkerDe(url, fonte).startsWith(`https://${worker}.mr-caiomendonca.workers.dev/proxy?media=1&url=`));
  }
});

test("cache de resolução usa chave estável", () => {
  const args = ["30984", "tv", 1, 1];
  assert.equal(typeof chaveResolucao, "function");
  assert.equal(chaveResolucao("dgo", args), chaveResolucao("dgo", args));
});

test("edgeResolverDe, resolveWorkerDe e RESOLVE_WORKER_POR_FONTE não são mais exportados", () => {
  // Pin da remoção do Task 9: se alguém readicionar qualquer um destes ao módulo, este caso falha.
  assert.equal("edgeResolverDe" in politica, false);
  assert.equal("resolveWorkerDe" in politica, false);
  assert.equal("RESOLVE_WORKER_POR_FONTE" in politica, false);
});

test("relay HLS usa cache separado para playlist e segmentos", () => {
  const worker = fs.readFileSync(path.join(__dirname, "../../infra/workers/mirror-cdn.js"), "utf8");
  assert.match(worker, /const TTL_PLAYLIST\s*=/);
  assert.match(worker, /const chavePlaylist\s*=\s*new Request/);
  assert.match(worker, /caches\.default\.put\(chavePlaylist/);
  assert.match(worker, /caches\.default\.put\(chaveSegmento/);
  assert.match(worker, /if \(relayRef\) headersPlaylist\.Referer = relayRef/);
});

test("resolveBatchUrl monta a URL do gateway com todos os parâmetros", () => {
  globalThis.MIRROR_GATEWAY = "https://gw.example";
  try {
    const url = resolveBatchUrl(["tt1632701", "tv", 2, 16], "mirrorstream:spc");
    assert.equal(url, "https://gw.example/resolve-batch?id=tt1632701&type=tv&season=2&episode=16&preferida=mirrorstream%3Aspc");
  } finally {
    delete globalThis.MIRROR_GATEWAY;
  }
});

test("season/episode ausentes viram '-', como o resolve-edge fazia", () => {
  globalThis.MIRROR_GATEWAY = "https://gw.example";
  try {
    const url = resolveBatchUrl(["603", "movie", null, null]);
    assert.match(url, /season=-/);
    assert.match(url, /episode=-/);
    assert.ok(!url.includes("preferida"), "sem preferida não há parâmetro");
  } finally {
    delete globalThis.MIRROR_GATEWAY;
  }
});

// Review Focus 1 virou isto: o serviço está NO AR, então o bundle já nasce com
// base — `GATEWAY_PADRAO` deixou de ser `""` no passo 3 do deploy (spec §12).
// O que continua sendo contrato é a ORDEM: `globalThis.MIRROR_GATEWAY` (o
// override de teste) por cima do default, e `process.env` nunca.
test("a base vem de GATEWAY_PADRAO e o override MIRROR_GATEWAY continua por cima", () => {
  const { GATEWAY_PADRAO } = politica;
  delete globalThis.MIRROR_GATEWAY;
  delete process.env.MIRROR_GATEWAY;          // não pode existir, mas garante o estado

  assert.ok(GATEWAY_PADRAO, "GATEWAY_PADRAO não pode mais ser vazio: o serviço está no ar");
  assert.match(GATEWAY_PADRAO, /^https:\/\//, "a URL pública é https");

  const padrao = resolveBatchUrl(["603", "movie", null, null]);
  assert.equal(padrao, `${GATEWAY_PADRAO}/resolve-batch?id=603&type=movie&season=-&episode=-`);

  globalThis.MIRROR_GATEWAY = "https://gw.example";
  try {
    assert.match(resolveBatchUrl(["603", "movie", null, null]), /^https:\/\/gw\.example\//);
  } finally {
    delete globalThis.MIRROR_GATEWAY;
  }
});

test("id com dois-pontos sobrevive ao encodeURIComponent", () => {
  globalThis.MIRROR_GATEWAY = "https://gw.example";
  try {
    const url = resolveBatchUrl(["tmdb:603", "movie", null, null]);
    assert.ok(url.includes("id=tmdb%3A603"));
  } finally {
    delete globalThis.MIRROR_GATEWAY;
  }
});
