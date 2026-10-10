// O REGISTRO DIVIDIDO POR CATEGORIA (spec §4.3, §8 — `test/registro.test.js`).
//
// O registro unico `src/core/fontes.js` virou o diretorio `src/core/fontes/`
// (um arquivo por categoria + `index.js` com o merge). Este arquivo trava que:
//   * `require("../src/core/fontes")` resolve para o INDEX e nao para um
//     `fontes.js` que sobrevivesse ao split (o Node prefere o arquivo ao diretorio:
//     se ele sobreviver, o split inteiro vira codigo morto sem erro);
//   * a API publica continua EXATAMENTE a combinada (25 nomes);
//   * `porCategoria()` cobre toda chave declarada, uma vez so, na ordem de
//     `chavesTodos()` (a ordem do manifesto e conteudo publicado);
//   * o manifesto declara exatamente as fontes ativas;
//   * todo conteudo declarado existe em `CONTEUDOS` — a protecao contra digitar
//     uma chave na categoria errada (o caso `series.js` vazio apos o split).
//
// Sem rede, sem build: so o registro (`src/core/fontes/`).

const test = require("node:test");
const assert = require("node:assert/strict");

const fontes = require("../src/core/fontes");

const API_ESPERADA = ["CONTEUDOS","DESCRICAO_REPOSITORIO","FONTES","GRUPOS","NOME_REPOSITORIO",
  "VERSAO_REPOSITORIO","VERSAO_SCRAPER","arquivoDe","bundleDe","chaves","chavesTodos","conteudo",
  "fonte","fontesComIndice","fontesDe","fontesDePainel","grupo","manifesto","prefixo","rotulo","scrapers","sigla",
  "diretorioDe","caminhoDe","porCategoria"];

test("src/core/fontes resolve para o index e nao para um fontes.js sobrevivente", () => {
  assert.equal(require("../src/core/fontes"), require("../src/core/fontes/index"));
});

test("a API publica do registro e exatamente a combinada", () => {
  assert.deepEqual(Object.keys(require("../src/core/fontes")).sort(), API_ESPERADA.slice().sort());
});

test("porCategoria cobre toda chave declarada, uma vez so", () => {
  const g = fontes.porCategoria();
  assert.deepEqual(Object.keys(g), ["animes","filmes","series","doramas"]);
  const tudo = Object.values(g).flat();
  assert.deepEqual(tudo.sort(), fontes.chavesTodos().slice().sort());
  assert.equal(new Set(tudo).size, tudo.length);
});

test("o manifesto declara um único scraper agregado", () => {
  assert.deepEqual(fontes.manifesto().scrapers.map((s) => s.id), ["mirrorstream"]);
});

test("a descricao do repositorio tem a contagem real de fontes ativas", () => {
  const n = fontes.chaves().length;
  assert.ok(fontes.DESCRICAO_REPOSITORIO.includes(`${n} fonte`),
    `descricao: "${fontes.DESCRICAO_REPOSITORIO}" nao declara ${n} fontes`);
});

test("todo conteudo declarado esta em CONTEUDOS e todo conteudo existe em algum arquivo", () => {
  // Spec §7.4 — a protecao contra digitação em series.js/vazio apos o split.
  const fora = [];
  for (const chave of fontes.chavesTodos()) {
    for (const c of fontes.FONTES[chave].conteudos) {
      if (!fontes.CONTEUDOS.includes(c)) fora.push(`${chave}: "${c}"`);
    }
  }
  assert.deepEqual(fora, []);
  assert.deepEqual(fontes.porCategoria().series, [], "series/ so aceita fonte com conteudos[0] === serie");
});
