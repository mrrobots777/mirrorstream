// O RESUMO POR CATEGORIA.
//
// Ate aqui as medicoes falavam por fonte: uma linha por fonte, e a linha de total. Com os
// scrapers separados em `animes/`, `filmes/`, `series/` e `doramas/`, a pergunta que o time
// faz nao e' "a fonte `dgo` respondeu?" e' "anime esta de pe?". O agregado responde a segunda
// sem perder a primeira.
//
// As duas funcoes sao PURAS e recebem `diretorioDe` por parametro: e' o que as deixa
// testaveis sem rede e sem o registro (ver o teste da categoria desconhecida, que so existe
// porque o mapa vem de fora).

const test = require("node:test");
const assert = require("node:assert/strict");

const { agruparStreams } = require("../src/lib/agregador");
const { matchVodTitle, numeroDaTemporada, bonusTemporada } = require("../src/lib/match");

const fontes = require("../src/core/fontes");
const { agrupaPorCategoria, linhaPorCategoria } = require("../tools/medicao/resumo");

test("agregador devolve uma fonte por qualidade, em ordem de resolução", () => {
  const resultado = agruparStreams([
    [
      { url: "https://a/1080.mp4", quality: "1080p", name: "BLZ", provider: "BLZ" },
      { url: "https://a/720.mp4", quality: "720p", name: "BLZ" },
    ],
    [
      { url: "https://b/1080.mp4", quality: "1080", name: "SPC" },
      { url: "https://b/2160.mp4", quality: "4K", name: "SPC" },
      { url: "https://b/unknown.mp4", name: "SPC" },
    ],
  ]);
  assert.deepEqual(resultado.map((s) => s.quality), ["2160p", "1080p", "720p", undefined]);
  assert.deepEqual(resultado.map((s) => s.name), ["☁️ MirrorStream · 2160p · Idioma não informado", "☁️ MirrorStream · 1080p · Idioma não informado", "☁️ MirrorStream · 720p · Idioma não informado", "☁️ MirrorStream · Qualidade não informada · Idioma não informado"]);
  assert.deepEqual(resultado.map((s) => s.provider), ["☁️ MirrorStream", "☁️ MirrorStream", "☁️ MirrorStream", "☁️ MirrorStream"]);
  assert.equal(resultado[1].url, "https://a/1080.mp4");
});

test("agregador preserva links distintos quando a fonte não informa qualidade", () => {
  const resultado = agruparStreams([[
    { url: "https://a/sem-rotulo.mp4" },
    { url: "https://b/sem-rotulo.mp4" },
    { url: "https://a/sem-rotulo.mp4" }
  ]]);
  assert.deepEqual(resultado.map((s) => s.url), ["https://a/sem-rotulo.mp4", "https://b/sem-rotulo.mp4"]);
  assert.deepEqual(resultado.map((s) => s.quality), [undefined, undefined]);
});

test("agregador mantém dublado e legendado na mesma qualidade", () => {
  const resultado = agruparStreams([[
    { url: "https://a/1080-dub.mp4", quality: "1080p", title: "Dublado · BLZ" },
    { url: "https://a/1080-sub.mp4", quality: "1080p", title: "Legendado · BLZ" },
    { url: "https://b/1080-dub.mp4", quality: "1080p", title: "Dublado · SPC" }
  ]]);
  assert.deepEqual(resultado.map((s) => s.url), ["https://a/1080-dub.mp4", "https://a/1080-sub.mp4"]);
});

test("agregador sempre expõe o idioma na segunda linha do Nuvio", () => {
  const resultado = agruparStreams([[
    { url: "https://a/dub.mp4", quality: "720p", idioma: "Dublado" },
    { url: "https://a/leg.mp4", quality: "720p", title: "S03E12", idioma: "Legendado" },
    { url: "https://a/unknown.mp4", quality: "480p", title: "S03E12" }
  ]]);
  assert.match(resultado[0].title, /Dublado/);
  assert.match(resultado[1].title, /Legendado/);
  assert.match(resultado[2].title, /Idioma não informado/);
});

test("agregador marca o bingeGroup estável da fonte", () => {
  const [stream] = agruparStreams([[
    { url: "https://a/720.mp4", quality: "720p", title: "Dublado · BLZ", __mirrorSource: "blz" }
  ]]);
  assert.equal(stream.behaviorHints.bingeGroup, "mirrorstream:blz");
  assert.equal(stream.__mirrorSource, undefined);
});

test("motor reconhece temporada romana em título de série/anime", () => {
  assert.equal(matchVodTitle("Mushoku Tensei III: Isekai Ittara Honki Dasu", "Mushoku Tensei: Jobless Reincarnation", true), true);
  assert.equal(matchVodTitle("Mushoku Tensei III", "Mushoku Tensei", false), false);
});

test("motor reconhece divisões Season/Temporada/Part/Cour/S", () => {
  for (const [nome, numero] of [
    ["Bleach Season 2", 2], ["Bleach Temporada 3", 3], ["Bleach Part 2", 2],
    ["Bleach Cour 2", 2], ["Bleach S04", 4], ["Bleach IV", 4], ["Bleach 5", 5]
  ]) {
    assert.equal(matchVodTitle(nome, "Bleach", true), true, nome);
    assert.equal(numeroDaTemporada(nome), numero, nome);
    assert.equal(bonusTemporada(nome, numero), 15, nome);
  }
});

test("motor não confunde filme/OVA/especial com temporada de série", () => {
  assert.equal(matchVodTitle("Bleach Movie 2", "Bleach", true), false);
  assert.equal(matchVodTitle("Bleach OVA", "Bleach", true), false);
  assert.equal(matchVodTitle("Bleach Special", "Bleach", true), false);
});

// Chaves REAIS do registro (`shg`/`ise` sao animes, `blz` filme, `dgo` dorama). Injetar o
// `fontes.diretorioDe` de verdade e' obrigatorio: um mock identidade devolveria a chave
// ("shg") como se fosse o nome de uma categoria, e o teste passaria a descrever um mundo
// que o registro nao tem.
const ITENS = [
  { chave: "shg", ok: true },
  { chave: "ise", ok: true },
  { chave: "blz", ok: true },
  { chave: "dgo", ok: false },
];

test("agrupa por categoria na ordem fixa e sempre devolve as quatro", () => {
  assert.deepEqual(agrupaPorCategoria(ITENS, fontes.diretorioDe), [
    { categoria: "animes", total: 2, ok: 2 },
    { categoria: "filmes", total: 1, ok: 1 },
    { categoria: "series", total: 0, ok: 0 },
    { categoria: "doramas", total: 1, ok: 0 },
  ]);
});

test("categoria vazia entra como 0/0 e a linha sai estavel", () => {
  assert.equal(
    linhaPorCategoria(agrupaPorCategoria([], fontes.diretorioDe)),
    "animes 0/0 | filmes 0/0 | series 0/0 | doramas 0/0"
  );
});

test("a linha traz as quatro categorias na ordem do registro", () => {
  assert.equal(
    linhaPorCategoria(agrupaPorCategoria(ITENS, fontes.diretorioDe)),
    "animes 2/2 | filmes 1/1 | series 0/0 | doramas 0/1"
  );
});

test("categoria fora das quatro é erro, não um grupo silencioso", () => {
  // Um `conteudos[0]` digitado errado viraria um quinto grupo que o leitor nao conhece, e a
  // medicao pareceria completa. Aqui ela quebra na origem, dizendo de quem e' a culpa.
  assert.deepEqual(agrupaPorCategoria([{ chave: "x", ok: true }], () => "animes"), [
    { categoria: "animes", total: 1, ok: 1 },
    { categoria: "filmes", total: 0, ok: 0 },
    { categoria: "series", total: 0, ok: 0 },
    { categoria: "doramas", total: 0, ok: 0 },
  ]);
  assert.throws(() => agrupaPorCategoria([{ chave: "x", ok: true }], () => "series2"), /x/);
  assert.throws(() => agrupaPorCategoria([{ chave: "x", ok: true }], () => "series2"), /series2/);
});

test("a ordem das categorias é a do registro, não a de.constants", () => {
  // Se um dia o registro ganhar uma quinta categoria, esta asserção quebra e alguém decide
  // se o resumo a mostra — em vez do resumo silenciosamente ficar para tras.
  assert.deepEqual(
    ["animes", "filmes", "series", "doramas"],
    Object.keys(fontes.porCategoria())
  );
});
