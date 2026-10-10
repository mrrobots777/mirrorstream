// Casos representativos das 11 fontes (mesmo caso para todas quando a bateria
// recebe `<id> <type> [temp ep]`), + a chave do TMDB do ambiente.
// Compartilhado por bateria.js e mime.js para os dois lerem o MESMO caso.

const path = require("path");
const { RAIZ } = require("../_caminhos");
const fs = require("fs");

function chaveTmdb() {
  const env = process.env.TMDB_API_KEY;
  if (env && String(env).trim()) return String(env).trim();
  const padrao = /TMDB_API_KEY\s*=\s*["']?([0-9a-zA-Z_-]{20,})["']?/;
  for (const arquivo of [path.join(RAIZ, "config", "tmdb.js")]) {
    try {
      const m = fs.readFileSync(arquivo, "utf8").match(padrao);
      if (m) return m[1];
    } catch (_) {}
  }
  return null;
}

const PADRAO = {
  shg: ["30984", "tv", 1, 1],
  ron: ["30984", "tv", 1, 1],
  aon: ["30984", "tv", 1, 1],
  atb: ["30984", "tv", 1, 1],
  spt: ["603", "movie", null, null],
  blz: ["603", "movie", null, null],
  // MEDIDO 08/10/2026: o caso era 603 (Matrix) e os DOIS arquivos dele no painel SPC
  // respondem 404 — arquivo morto na origem, nao fonte quebrada. Cinco filmes medidos
  // (278, 550, 13, 680, 329865) respondem 206. O caso trocou para um titulo vivo para o
  // monitor nao passar a reportar um item morto como queda da fonte.
  spc: ["550", "movie", null, null],
  ato: ["603", "movie", null, null],
  rtd: ["30984", "tv", 1, 1],
  dgo: ["94796", "tv", 1, 1],
  vzr: ["603", "movie", null, null],
  // Fontes de anime com MP4 por episodio (MEDIDO 08/10/2026): 30984 e' Bleach, que ambas
  // servem desde o episodio 1. `ise` e' a que tem o episodio mais fundo em um teste curto.
  ise: ["30984", "tv", 1, 1],
  san: ["30984", "tv", 1, 1],
  anf: ["30984", "tv", 1, 1],
};

function casosDosArgs(argv) {
  // `node tools/medicao/bateria.js 1396 tv 1 5` → mesmo caso para todas as fontes.
  if (argv.length >= 2 && ["movie", "tv", "channel"].includes(argv[1])) {
    const s = argv[2];
    const e = argv[3];
    return [argv[0], argv[1], s === undefined || s === "" ? null : Number(s), e === undefined || e === "" ? null : Number(e)];
  }
  return null;
}

module.exports = { chaveTmdb, PADRAO, casosDosArgs };
