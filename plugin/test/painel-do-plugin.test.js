"use strict";

// A credencial do gerador de shards tem de vir do AMBIENTE.
//
// MEDIDO 10/10/2026: no commit que tirou as credenciais do código, o
// `publicar-pages` quebrou. O log do CI dizia
// `[indice] ALERTA blz sem shard: Cannot read properties of undefined (reading 'porta')`
// e depois `[indice] erro: nenhuma fonte gerou shard` — exit 1, nada publicado.
// A causa era exatamente esta função: ela batia uma regex no TEXTO do scraper
// procurando `|| "literal"`, e o scraper parou de ter o literal. Sem credencial
// não há `player_api.php`, e sem ele não há shard nenhum.
//
// O efeito prático do estrago é maior do que um workflow vermelho: enquanto o
// Pages não publica, o bundle NO AR continua sendo o antigo — com o fallback da
// credencial dentro. Ou seja, a limpeza só existe de verdade quando o Pages
// passa. É por isso que este teste trava a origem da credencial.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { painelDoPlugin } = require("../tools/publicacao/painel-do-plugin");
const fontes = require("../src/core/fontes");

const RAIZ = path.join(__dirname, "..");
const caminho = (chave) => fontes.caminhoDe(chave);

function semAmbiente() {
  for (const chave of ["blz", "spc", "ato"]) {
    delete process.env[`MIRROR_${chave.toUpperCase()}_USER`];
    delete process.env[`MIRROR_${chave.toUpperCase()}_PASS`];
  }
}

test("a credencial vem do ambiente quando ele esta definido", () => {
  semAmbiente();
  try {
    process.env.MIRROR_BLZ_USER = "usuario-do-ambiente";
    process.env.MIRROR_BLZ_PASS = "senha-do-ambiente";
    const p = painelDoPlugin(RAIZ, caminho, "blz");
    assert.equal(p.usuario, "usuario-do-ambiente");
    assert.equal(p.senha, "senha-do-ambiente");
  } finally {
    semAmbiente();
  }
});

test("sem ambiente e sem literal no codigo, o campo vem VAZIO (nao ha default)", () => {
  semAmbiente();
  // O scraper nao tem mais `|| "senha"`. Se este teste passar vazio, o codigo
  // esta limpo; se passar com uma senha, o fallback voltou.
  const p = painelDoPlugin(RAIZ, caminho, "blz");
  assert.equal(p.usuario, "");
  assert.equal(p.senha, "");
});

test("o parse do codigo aindavale como ULTIMO caso (scraper com default)", () => {
  // Um scraper que ainda tenha default embutido continua funcionando como
  // antes — a mudanca e' so' a ORDEM, e este teste impede que a ordem inverta.
  semAmbiente();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "painel-"));
  const raizFalso = path.join(tmp, "plugin");
  fs.mkdirSync(path.join(raizFalso, "src", "scrapers", "filmes"), { recursive: true });
  fs.writeFileSync(
    path.join(raizFalso, "src", "scrapers", "filmes", "painel-blaze.js"),
    'const PAINEL = { sigla: "BLZ", idx: "blz", servidor: "kakito.xyz", porta: "443",\n' +
      '  get usuario() { return globalThis.MIRROR_BLZ_USER || "UsuarioDoScraper"; },\n' +
      '  get senha() { return globalThis.MIRROR_BLZ_PASS || "SenhaDoScraper"; } };\n'
  );
  try {
    const p = painelDoPlugin(raizFalso, caminho, "blz");
    assert.equal(p.usuario, "UsuarioDoScraper");
    assert.equal(p.senha, "SenhaDoScraper");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
