// E2E de fluxo: simula o USUARIO do Nuvio (que instala o plugin) percorrendo as 11
// fontes em conteudos reais, e separa o que e' nosso do que e' da origem.
//
//   node tools/e2e-usuario.js            todas as fontes, 3 titulos
//   node tools/e2e-usuario.js vzr blz    so estas
//   PROBE=1                              prova o link (Range de 2 KB)
//
// REGRA (a mesma do `provar-links.js`): 403/429/5xx/timeout NAO e' "fonte morta" — o
// video e' baixado pelo aparelho, do IP residencial de quem assiste. So 404/410/451 e
// 2xx-sem-o-que-promete contam como morto.
const path = require("path");
const fs = require("fs");

const { RAIZ: raiz } = require("../_caminhos");
const fontes = require(path.join(raiz, "src", "core", "fontes"));

function chaveTmdb() {
  const padroes = [
    /TMDB_API_KEY\s*\|\|\s*["']([^"']+)["']/,
    /TMDB_API_KEY\s*=\s*["']?([0-9a-zA-Z_-]{20,})["']?/,
  ];
  for (const arquivo of [
    path.join(raiz, "..", "mirrorstream", "src", "scrapers", "tmdb.js"),
    path.join(raiz, "..", "mirrorstream", "ecosystem.config.js"),
  ]) {
    try {
      const txt = fs.readFileSync(arquivo, "utf8");
      for (const p of padroes) {
        const m = txt.match(p);
        if (m) return m[1];
      }
    } catch (_) {}
  }
  return null;
}

const chave = chaveTmdb();
if (chave) globalThis.TMDB_API_KEY = chave;

// Ids VERIFICADOS no TMDB (medido 02/10/2026): conferi `origin_country` include "KR" para os
// doramas e peguei o `imdb_id` de `/tv/{id}/external_ids`. Um id errado faz a fonte recusar o
// titulo e o resultado vira "a fonte quebrou", que e' conclusao errada.
//
// O `id` e' o do CINEMETA (IMDb), e nao o do TMDB — porque e' esse o caminho real: o dono
// definiu que o MirrorStream nao tem catalogo, ele e' chamado quando o usuario abre um vod, e
// o Cinemeta resolve por IMDb. Os ids de TMDB ficam em `idTmdb` so para conferir a origem.
const CASOS = [
  { id: "tt0133093", idTmdb: "603", tipo: "movie", conteudo: "filme", titulo: "Matrix (1999)", s: null, e: null },
  { id: "tt0903747", idTmdb: "1396", tipo: "tv", conteudo: "serie", titulo: "Breaking Bad S01E01", s: 1, e: 1 },
  { id: "tt0409591", idTmdb: "46260", tipo: "tv", conteudo: "anime", titulo: "Naruto S01E01", s: 1, e: 1 },
  { id: "tt5994364", idTmdb: "67915", tipo: "tv", conteudo: "dorama", titulo: "Goblin S01E01", s: 1, e: 1 },
  { id: "tt13274038", idTmdb: "112888", tipo: "tv", conteudo: "dorama", titulo: "Beleza Verdadeira S01E01", s: 1, e: 1 },
];

async function provaLink(url) {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-2047" }, redirect: "follow" });
    const tipo = String(r.headers.get("content-type") || "").toLowerCase();
    if (r.status === 404 || r.status === 410 || r.status === 451) return "MORTO";
    if (r.status === 403 || r.status === 429) return "BLOQUEADO(ip)";
    if (r.status >= 500) return "ORIGEM_5xx";
    if (tipo.includes("text/html")) return "HTML(erro?)";
    return r.status === 206 || r.ok ? "VIVO" : `HTTP_${r.status}`;
  } catch (e) {
    return "INDECISO(rede)";
  }
}

async function main() {
  const pedidas = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const lista = pedidas.length ? pedidas.filter((c) => fontes.FONTES[c]) : fontes.chaves();
  const soProbe = process.env.PROBE === "1";

  console.log(`plugin: ${lista.length} fontes x ${CASOS.length} casos`);
  if (!chave) console.log("AVISO: TMDB_API_KEY nao achada — as fontes que dependem dela vao recusar");
  console.log("=".repeat(78));

  const resumo = {};
  for (const chaveFonte of lista) {
    const f = fontes.FONTES[chaveFonte];
    const mod = require(path.join(raiz, "dist", fontes.bundleDe(chaveFonte)));
    resumo[chaveFonte] = { ok: 0, vazio: 0, erro: 0, morreu: 0 };
    console.log(`\n### ${chaveFonte.toUpperCase()} — ${f.descricao}`);
    for (const caso of CASOS) {
      // A fonte so e' chamada quando o conteudo bate com o que ela promete. O `conteudo` e'
      // DECLARADO no caso, e nao deduzido do id: quando o id era o de TMDB, a deduziao vivia
      // no id (`caso.id === "46260"` -> anime) e passou a classificar Naruto como serie depois
      // que o id virou IMDb `tt0409591` — as 4 fontes de anime sairam do relatorio com "vazio 0"
      // sem nunca terem sido chamado. Um relatorio que filtra errado e' pior que nenhum.
      const conteudo = caso.conteudo;
      if (!f.conteudos.includes(conteudo)) {
        console.log(`  - ${caso.titulo}: fora do conteudo da fonte (${f.conteudos.join("/")}) — nao chamada`);
        continue;
      }
      const t0 = Date.now();
      let lista2;
      try {
        lista2 = await mod.getStreams(caso.id, caso.tipo, caso.s, caso.e);
      } catch (e) {
        resumo[chaveFonte].erro++;
        console.log(`  x ${caso.titulo}: LANCOU em ${Date.now() - t0}ms — ${e && e.message}`);
        continue;
      }
      const ms = Date.now() - t0;
      if (!Array.isArray(lista2) || !lista2.length) {
        resumo[chaveFonte].vazio++;
        console.log(`  - ${caso.titulo}: 0 streams em ${ms}ms`);
        continue;
      }
      resumo[chaveFonte].ok++;
      const primeiro = lista2[0];
      const url = typeof primeiro.url === "object" ? primeiro.url && primeiro.url.url : primeiro.url;
      const veredito = soProbe && url ? await provaLink(url) : "";
      console.log(`  + ${caso.titulo}: ${lista2.length} stream(s) em ${ms}ms — "${primeiro.name || ""}" q=${primeiro.quality || "-"} lang=${primeiro.language || "-"}${veredito ? " | " + veredito : ""}`);
      if (!url) console.log(`      !! item sem url — o Nuvio descarta`);
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log("RESUMO (ok = entregou | vazio = disse que nao tem | erro = lancou | morreu = link 404/410/451)");
  for (const c of lista) {
    const r = resumo[c];
    console.log(`  ${c.toUpperCase().padEnd(5)} ok ${String(r.ok).padStart(2)}  vazio ${String(r.vazio).padStart(2)}  erro ${r.erro}  morreu ${r.morreu}`);
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : String(e));
  process.exit(1);
});