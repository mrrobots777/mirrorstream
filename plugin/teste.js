const fs = require("fs");
const path = require("path");

const fontes = require("./src/core/fontes");

const raiz = __dirname;
const TIPOS = ["movie", "tv", "channel"];

function uso(motivo) {
  if (motivo) console.error(`erro: ${motivo}`);
  console.error("uso: node teste.js <fonte> <tmdbId> movie|tv [temporada] [episodio]");
  process.exit(2);
}

function chaveTmdb() {
  const env = process.env.TMDB_API_KEY;
  if (env && String(env).trim()) return String(env).trim();
  try {
    const { ENV } = require(path.join(raiz, "..", "mirrorstream", "src", "core", "nomes.js"));
    if (ENV.TMDB_API_KEY && String(ENV.TMDB_API_KEY).trim()) return String(ENV.TMDB_API_KEY).trim();
  } catch (_) {}
  const padroes = [
    /TMDB_API_KEY\s*=\s*["']?([0-9a-zA-Z_-]{20,})["']?/,
    /TMDB_API_KEY\s*\|\|\s*["']([^"']+)["']/,
    /TMDB_API_KEY["']?\s*:\s*["']([^"']+)["']/,
  ];
  const candidatos = [
    path.join(raiz, "..", "mirrorstream", ".env.example"),
    path.join(raiz, "..", "mirrorstream", "src", "scrapers", "tmdb.js"),
    path.join(raiz, "..", "mirrorstream", "ecosystem.config.js"),
  ];
  for (const arquivo of candidatos) {
    try {
      const txt = fs.readFileSync(arquivo, "utf8");
      for (const padrao of padroes) {
        const m = txt.match(padrao);
        if (m) return m[1];
      }
    } catch (_) {}
  }
  return null;
}

const [fonte, tmdbId, tipo, tempCru, epCru] = process.argv.slice(2);
if (!fonte || !tmdbId || !tipo) uso();
if (!fontes.FONTES[fonte]) uso(`fonte "${fonte}" fora do registro (src/core/fontes/): ${fontes.chaves().join(", ")}`);
if (!TIPOS.includes(tipo)) uso(`tipo "${tipo}" (esperado movie|tv|channel)`);
const temp = tempCru === undefined || tempCru === "" ? null : Number(tempCru);
const ep = epCru === undefined || epCru === "" ? null : Number(epCru);
if (temp !== null && !Number.isFinite(temp)) uso("temporada precisa ser numero");
if (ep !== null && !Number.isFinite(ep)) uso("episodio precisa ser numero");

const chave = chaveTmdb();
if (chave) globalThis.TMDB_API_KEY = chave;

// Base do indice estatico (blz/spc/ato). Sem isto o provider usa o default do codigo,
// que aponta para o GitHub Pages do plugin. Para testar localmente:
//
//   python3 -m http.server 8799 --directory public &
//   MIRROR_INDEX_BASE=http://127.0.0.1:8799 node teste.js blz 603 movie
//
// Documentado em `public/PLANO-PUBLICACAO.md`.
const baseIndice = process.env.MIRROR_INDEX_BASE || globalThis.MIRROR_INDEX_BASE;
if (baseIndice) globalThis.MIRROR_INDEX_BASE = String(baseIndice).replace(/\/+$/, "");
const modoBlz = process.env.MIRROR_BLZ_CATALOGO;
if (modoBlz) globalThis.MIRROR_BLZ_CATALOGO = String(modoBlz);

const dist = path.join(raiz, "dist", fontes.bundleDe(fonte));
const origem = path.join(raiz, fontes.caminhoDe(fonte));
const arquivo = fs.existsSync(dist) ? dist : origem;
if (!fs.existsSync(arquivo)) uso(`nao achei ${path.relative(raiz, dist)} nem ${path.relative(raiz, origem)}`);

const mod = require(arquivo);
if (typeof mod.getStreams !== "function") uso(`${path.relative(raiz, arquivo)} nao exporta getStreams`);

console.log(`fonte:    ${fonte} (${fontes.rotulo(fonte)} | ${fontes.conteudo(fonte)})`);
console.log(`id:       ${tmdbId}`);
console.log(`tipo:     ${tipo}`);
console.log(`temp/ep:  ${temp === null ? "-" : temp} / ${ep === null ? "-" : ep}`);
console.log(`modulo:   ${path.relative(raiz, arquivo)}`);
console.log(`tmdb key: ${chave ? "definida" : "ausente"}`);
if (globalThis.MIRROR_INDEX_BASE) console.log(`indice:   ${globalThis.MIRROR_INDEX_BASE}`);
if (globalThis.MIRROR_BLZ_CATALOGO) console.log(`blz cat:  ${globalThis.MIRROR_BLZ_CATALOGO}`);
console.log("-".repeat(60));

(async () => {
  const inicio = Date.now();
  let lista;
  try {
    lista = await mod.getStreams(tmdbId, tipo, temp, ep);
  } catch (e) {
    console.error(`LANCOU depois de ${Date.now() - inicio}ms — no Nuvio isto nao derruba os outros scrapers:`);
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
  }
  const ms = Date.now() - inicio;
  if (!Array.isArray(lista)) {
    console.error(`getStreams devolveu ${typeof lista}, esperado array`);
    process.exit(1);
  }
  if (!lista.length) {
    console.log(`0 streams em ${ms}ms — a fonte disse que nao tem o titulo ([] nao e erro)`);
    return;
  }
  console.log(`${lista.length} stream(s) em ${ms}ms`);
  if (lista.length > 150) console.log("AVISO: acima de 150 itens o Nuvio corta a lista");
  let semUrl = 0;
  lista.forEach((s, i) => {
    if (!s || typeof s !== "object") {
      console.log(`${i + 1}) item invalido: ${JSON.stringify(s)}`);
      semUrl += 1;
      return;
    }
    const url = typeof s.url === "object" && s.url ? s.url.url : s.url;
    if (!url) semUrl += 1;
    console.log(`${i + 1}) ${s.name || "(sem name)"}${s.title ? ` — ${s.title}` : ""}`);
    console.log(`   quality: ${s.quality || "-"} | size: ${s.size || "-"}`);
    console.log(`   url: ${url || "(SEM URL — o Nuvio descarta o item)"}`);
    if (s.headers && Object.keys(s.headers).length) console.log(`   headers: ${JSON.stringify(s.headers)}`);
    if (Array.isArray(s.subtitles) && s.subtitles.length) console.log(`   legendas: ${s.subtitles.length}`);
  });
  console.log("-".repeat(60));
  if (semUrl) console.log(`AVISO: ${semUrl} item(ns) sem url (o Nuvio descarta)`);
  console.log(`${lista.length - semUrl} item(ns) jogaveis`);

  // Prova de que o link responde: Range de 2 KB, com os mesmos headers que o player
  // manda. `PROBE=1` liga (o padrao e so listar). Uma origem que recusa IP de datacenter
  // sai como `MORTO`/`STUB` aqui e isso NAO e defeito do provider — e do IP.
  if (process.env.PROBE === "1" && lista.length) {
    const { probe } = require(path.join(raiz, "tools", "medicao", "provar-links.js"));
    await probe(lista, { conc: Number(process.env.PROBE_CONC) || 4 });
  }
})().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
