// Bateria das 11 fontes do plugin: roda o `getStreams` de cada uma com um caso
// representativo e prova o link (Range de 2 KB, mesmos headers do player).
//
//   node tools/medicao/bateria.js                         # caso padrão de cada fonte
//   node tools/medicao/bateria.js 1396 tv 1 5             # MESMO caso para todas as fontes
//   FONTES=rei,emb,etc,rcd node tools/medicao/bateria.js   # só essas fontes
//   node tools/medicao/bateria.js canais <arquivo.json>    # um canal por linha (ids do addon)
//
// Base do índice (blz/spc/ato): MIRROR_INDEX_BASE (ver teste.js).
// Nada aqui é bundlado: é tooling Node.

const path = require("path");
const { RAIZ } = require("../_caminhos");
const fontes = require("../../src/core/fontes");
const { chaveTmdb, PADRAO, casosDosArgs } = require("./casos");
const { agrupaPorCategoria, linhaPorCategoria } = require("./resumo");

const chave = chaveTmdb();
if (chave) globalThis.TMDB_API_KEY = chave;
if (process.env.MIRROR_INDEX_BASE) globalThis.MIRROR_INDEX_BASE = String(process.env.MIRROR_INDEX_BASE).replace(/\/+$/, "");

async function roda(chave, caso) {
  const arquivo = path.join(RAIZ, "dist", fontes.bundleDe(chave));
  const t0 = Date.now();
  let lista = null;
  let erro = "";
  try {
    const mod = require(arquivo);
    lista = await mod.getStreams(caso[0], caso[1], caso[2], caso[3]);
  } catch (e) {
    erro = String((e && e.message) || e);
  }
  const ms = Date.now() - t0;
  if (erro) return { chave, ms, streams: -1, erro, vivos: 0, ruins: 0 };
  if (!Array.isArray(lista)) return { chave, ms, streams: -2, erro: `devolveu ${typeof lista}`, vivos: 0, ruins: 0 };
  if (!lista.length) return { chave, ms, streams: 0, vivos: 0, ruins: 0 };

  const { um: provar } = require("./provar-links");
  const conc = Number(process.env.PROBE_CONC) || 4;
  const alvos = lista.slice(0, Number(process.env.PROBE_MAX) || 3);
  const res = [];
  for (let i = 0; i < alvos.length; i += conc) {
    res.push(...(await Promise.all(alvos.slice(i, i + conc).map(provar))));
  }
  // `INDECISO` (429/timeout) e `BLOQUEADO` (recusa a IP de datacenter) NAO sao
  // link morto: e a regua do runtime (decisoes 131/134) aplicada a medicao, senao a
  // bateria acusa de morta uma fonte que o aparelho do usuario vai tocar.
  const vivos = res.filter((r) => ["ok", "INDECISO", "BLOQUEADO"].includes(r.veredito)).length;
  const ruins = res.filter((r) => ["MORTO", "RUIM", "STUB", "VAZIO"].includes(r.veredito)).length;
  return { chave, ms, streams: lista.length, vivos, ruins, amostra: res[0], url: (lista[0] && lista[0].url) || "" };
}

function listaDeFontes() {
  const env = process.env.FONTES;
  const base = env ? env.split(",").map((s) => s.trim()).filter(Boolean) : fontes.chaves();
  return base.filter((c) => fontes.FONTES[c]);
}

(async () => {
  const argv = process.argv.slice(2);
  const caso = casosDosArgs(argv);
  const alvos = listaDeFontes().map((chave) => ({ chave, caso: caso || PADRAO[chave] }));

  const t0 = Date.now();
  const out = [];
  for (const a of alvos) {
    const r = await roda(a.chave, a.caso);
    r.caso = a.caso;
    out.push(r);
    const estado = r.streams === -1 ? `LANCOU: ${r.erro}`
      : r.streams === -2 ? r.erro
      : r.streams === 0 ? "0 streams"
      : `${r.streams} streams | ${r.vivos} vivos | ${r.ruins} ruins`;
    const c = `${r.caso[0]} ${r.caso[1]}${r.caso[2] != null ? ` ${r.caso[2]}x${r.caso[3]}` : ""}`;
    console.log(`${r.chave.padEnd(4)} ${String(r.ms + "ms").padStart(7)}  ${c.padEnd(22)} ${estado}${r.amostra ? ` | ${r.amostra.faixa} ${r.amostra.status} ${r.amostra.bytes}B` : ""}`);
  }
  const ok = out.filter((r) => r.streams > 0 && r.vivos > 0).length;
  const sem = out.filter((r) => r.streams === 0).length;
  const falha = out.filter((r) => r.streams < 0).length;
  const semLink = out.filter((r) => r.streams > 0 && r.vivos === 0).length;
  console.log("-".repeat(72));
  console.log(`total ${Date.now() - t0}ms | com stream vivo ${ok}/${out.length} | sem titulo ${sem} | sem link vivo ${semLink} | lancou ${falha}`);
  // A pergunta do dia e' "anime esta de pe?", nao "a fonte dgo respondeu?". A linha
  // vem DEPOIS do total, e nao no lugar dele: o total continua valendo por fonte.
  const porCategoria = agrupaPorCategoria(
    out.map((r) => ({ chave: r.chave, ok: r.streams > 0 && r.vivos > 0 })),
    fontes.diretorioDe
  );
  console.log(`por categoria: ${linhaPorCategoria(porCategoria)}`);
  out.filter((r) => r.streams > 0 && r.vivos === 0).forEach((r) => console.log(`  sem link vivo: ${r.chave} (${r.ruins} ruins) url=${String(r.url).slice(0, 90)}`));
})().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});
