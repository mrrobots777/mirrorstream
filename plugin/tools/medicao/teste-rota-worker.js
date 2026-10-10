const path = require("path");
const { RAIZ, RAIZ_REPO } = require("../_caminhos");

const fontes = require("../../src/core/fontes");

//MEDIDO 01/10/2026: o painel ATO (`4x4u29c.autos`) nao responde a IP de datacenter —
// devolve a pagina "Welcome to nginx!" de 235 B ou trava. Como o gerador de indice ja usa
// o worker por fonte, este script reaproveita o MESMO caminho para provar que a logica do
// provider (shard -> matchVodTitle -> get_vod_info/get_series_info -> url) esta correta.
// O que ele NAO prova e o acesso direto a partir do aparelho do usuario — isso fica a cargo
// do aparelho (IP residencial). Ver `medicoes.md`, secao `ato`.
const ATIVO = process.env.MIRROR_TESTE_ROTA_ATOR === "1";
const WORKER = "https://mirror-ato.mr-caiomendonca.workers.dev/proxy?url=";

if (ATIVO) {
  const real = globalThis.fetch;
  globalThis.fetch = (alvo, init) => {
    const url = String(alvo);
    if (/4x4u29c\.autos/.test(url)) return real(`${WORKER}${encodeURIComponent(url)}`, init);
    return real(url, init);
  };
  console.log("[rota-ator] painel 4x4u29c.autos roteado pelo worker mirror-ato");
}

if (process.env.MIRROR_INDEX_BASE) globalThis.MIRROR_INDEX_BASE = String(process.env.MIRROR_INDEX_BASE).replace(/\/+$/, "");
const fs = require("fs");
let chave = null;
for (const f of [path.join(RAIZ_REPO, ".env.example"), path.join(RAIZ_REPO, "src", "scrapers", "tmdb.js")]) {
  try {
    const m = fs.readFileSync(f, "utf8").match(/TMDB_API_KEY\s*=\s*["']?([0-9a-zA-Z_-]{20,})/);
    if (m) { chave = m[1]; break; }
  } catch (_) {}
}
if (chave) globalThis.TMDB_API_KEY = chave;

const fonte = process.argv[2] || "ato";
const mod = require(path.join(RAIZ, "dist", fontes.bundleDe(fonte)));
const [tmdbId, tipo, s, e] = process.argv.slice(3);
const { probe } = require("./provar-links");

(async () => {
  const t0 = Date.now();
  const lista = await mod.getStreams(tmdbId, tipo, s ? Number(s) : null, e ? Number(e) : null);
  console.log(`\n${fonte}: ${lista.length} stream(s) em ${Date.now() - t0}ms`);
  for (const st of lista) console.log(`  ${st.name} — ${st.title} | ${st.url}`);
  if (lista.length && process.env.SEM_PROBE !== "1") await probe(lista, { conc: Number(process.env.PROBE_CONC) || 2 });
})().catch((e) => {
  console.error("LANCOU:", e && e.stack ? e.stack : String(e));
  process.exit(1);
});
