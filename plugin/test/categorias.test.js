// SCRAPERS NAS PASTAS DE CATEGORIA (spec §7, §8 — `test/categorias.test.js`).
//
// O caminho de cada scraper passou a ser DERIVADO do conteudo principal da fonte:
// `src/scrapers/<plural(conteudos[0])>/<arquivo>`. Quem monta o path a mao monta
// errado na hora em que uma fonte troca de categoria — e o erro aparece so no
// aparelho. Este arquivo trava a derivacao na origem (`fontes.caminhoDe`), a
// existencia fisica do arquivo e a coerencia do layout.
//
// Sem rede, sem build: so fs + o registro (`src/core/fontes/`).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const fontes = require("../src/core/fontes");

const PLURAL = { anime: "animes", filme: "filmes", serie: "series", dorama: "doramas" };

// Anda recursivo em `src/scrapers` e devolve caminhos relativos a RAIZ com
// separador posix (`src/scrapers/animes/otakulogia.js` — o formato de `caminhoDe`).
function varrerScrapers() {
  const saida = [];
  const anda = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) anda(p);
      else if (nome.endsWith(".js")) saida.push(path.relative(RAIZ, p).split(path.sep).join("/"));
    }
  };
  const raiz = path.join(RAIZ, "src", "scrapers");
  if (fs.existsSync(raiz)) anda(raiz);
  return saida.sort();
}

test("todo scraper vive na pasta da sua categoria principal", () => {
  const errados = [];
  for (const chave of fontes.chavesTodos()) {
    const dir = PLURAL[fontes.FONTES[chave].conteudos[0]];
    const esperado = `src/scrapers/${dir}/${fontes.arquivoDe(chave)}`;
    if (fontes.caminhoDe(chave) !== esperado) errados.push(`${chave}: ${fontes.caminhoDe(chave)} != ${esperado}`);
    if (!fs.existsSync(path.join(RAIZ, fontes.caminhoDe(chave)))) errados.push(`${chave}: arquivo inexistente`);
  }
  assert.deepEqual(errados, []);
});

test("nenhum .js em src/scrapers fica fora do registro", () => {
  const declarados = new Set(fontes.chavesTodos().map(chave => fontes.caminhoDe(chave)));
  const orfaos = varrerScrapers().filter(p => !declarados.has(p));
  assert.deepEqual(orfaos, []);
});

test("as quatro pastas de categoria existem, mesmo a series/ vazia", () => {
  // O spec §7.5: series/ vazio e' aceito e deve continuar visivel — nao e' erro.
  const faltando = ["animes","filmes","series","doramas"]
    .filter(d => !fs.existsSync(path.join(RAIZ, "src", "scrapers", d)));
  assert.deepEqual(faltando, []);
  const jsEmSeries = fs.readdirSync(path.join(RAIZ, "src", "scrapers", "series"))
    .filter(n => n.endsWith(".js"));
  assert.deepEqual(jsEmSeries, [], "series/ so pode ganhar .js com conteudos[0] === serie");
});

test("todo require relativo de src/scrapers resolve para um arquivo que existe", () => {
  const quebrados = [];
  for (const p of varrerScrapers()) {
    const txt = fs.readFileSync(path.join(RAIZ, p), "utf8");
    for (const m of txt.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
      // A resolucao e' estilo Node: `../../lib/http` e' `src/lib/http.js` — o
      // caminho literal sem extensao nao existe e marcaria todo require legimo.
      const alvo = path.join(path.dirname(p), m[1]);
      const resolvido = [alvo, `${alvo}.js`]
        .map((c) => path.join(RAIZ, c))
        .find((c) => fs.existsSync(c));
      if (!resolvido) quebrados.push(`${p} -> ${m[1]}`);
    }
  }
  assert.deepEqual(quebrados, []);
});
