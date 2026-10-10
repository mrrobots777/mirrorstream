// AUDITORIA DE CONTRATO — o que o aparelho realmente recebe de cada fonte.
//
// MEDIDO 02/10/2026: a maior parte dos "problemas" que chegam ao dono nao e' fonte quebrada, e'
// stream que a fonte entrega e o PLAYER nao consegue usar. A lista de casos ruins e' curta e
// todas as sao invisiveis num "entregou 3 streams":
//
//   * sem `url`            -> o Nuvio DESCARTA o item (fonte conta 3, tela mostra 0)
//   * sem `name`           -> o app escreve o rotulo de "qualidade desconhecida" (CONTRATO 1c)
//   * `Referer` exigido e nao declarado em `behaviorHints.proxyHeaders` -> o play da 403
//   * HLS em `.txt`/`.webp` sem parametro de formato -> o player baixa manifesto como video
//
// Este arquivo NAO e' do produto: ele roda contra as fontes reais e imprime o que achou.

const path = require("path");
const { RAIZ } = require("../_caminhos");
const fontes = require(path.join(RAIZ, "src", "core", "fontes"));

// Os casos, com o id do CINEMETA (IMDb) — o caminho que o dono definiu. Um id de TMDB aqui faz a
// fonte recusar o titulo e o relatorio dizer "quebrada" sem ela estar.
const CASOS = [
  { id: "tt0133093", tipo: "movie", conteudo: "filme", titulo: "Matrix" },
  { id: "tt0903747", tipo: "tv", conteudo: "serie", titulo: "Breaking Bad S01E01", s: 1, e: 1 },
  { id: "tt0409591", tipo: "tv", conteudo: "anime", titulo: "Naruto S01E01", s: 1, e: 1 },
  { id: "tt5994364", tipo: "tv", conteudo: "dorama", titulo: "Goblin S01E01", s: 1, e: 1 },
];

// O que o DGO exige, medido 02/10/2026: sem `Referer` a playlist responde 403; com
// `https://www.doramogo.net/` responde 206. Qualquer fonte que aponte para `madfirebox` e nao
// declarar isso vai mostrar na lista e dar 403 no play.
const EXIGE_REFERER = /madfirebox\.shop/i;

const PROBLEMAS = [];
function aponta(chave, caso, item, texto) {
  PROBLEMAS.push(`${chave.toUpperCase()} / ${caso.titulo}: ${texto}`);
}

function urlDe(s) {
  return s && typeof s.url === "object" ? s.url && s.url.url : s && s.url;
}
function headersDe(s) {
  const h = s && s.headers;
  if (h && typeof h === "object" && Object.keys(h).length) return h;
  const ph = s && s.behaviorHints && s.behaviorHints.proxyHeaders;
  if (ph && ph.request && Object.keys(ph.request).length) return ph.request;
  return null;
}

async function main() {
  const soProbe = process.env.PROBE === "1";
  const linksVivos = 0;
  let totais = 0;

  for (const chave of fontes.chaves()) {
    const f = fontes.FONTES[chave];
    const mod = require(path.join(RAIZ, "dist", fontes.bundleDe(chave)));
    for (const caso of CASOS) {
      if (!f.conteudos.includes(caso.conteudo)) continue;
      let lista;
      const t0 = Date.now();
      try {
        lista = await mod.getStreams(caso.id, caso.tipo, caso.s, caso.e);
      } catch (e) {
        PROBLEMAS.push(`${chave.toUpperCase()} / ${caso.titulo}: LANCOU ${e && e.message}`);
        continue;
      }
      if (!Array.isArray(lista) || !lista.length) {
        PROBLEMAS.push(`${chave.toUpperCase()} / ${caso.titulo}: 0 streams (${Date.now() - t0}ms)`);
        continue;
      }
      for (const item of lista) {
        totais++;
        const url = urlDe(item);
        if (!url) {
          aponta(chave, caso, item, `item SEM URL — o Nuvio descarta (de ${lista.length})`);
          continue;
        }
        if (!item.name) aponta(chave, caso, item, "item sem `name` — o app escreve 'Desconhecido'");
        // O Referer exigido pela origem precisa estar no objeto, senao o item aparece e nao toca.
        if (EXIGE_REFERER.test(url) && !(headersDe(item) || {}).Referer) {
          aponta(chave, caso, item, `aponta para um CDN que exige Referer e nao declara: ${url.slice(0, 60)}`);
        }
        // HLS que parece texto: o player infere o tipo pelo caminho (CONTRATO 1c).
        if (/\.(m3u8|txt|webp|ts)(\?|$)/i.test(url) && !/format=|type=hls|ext=m3u8/i.test(url)) {
          // .m3u8 e .ts sao reconhecidos pelo proprio caminho; .txt/.webp nao.
          if (/\.(txt|webp)(\?|$)/i.test(url)) {
            aponta(chave, caso, item, `HLS em arquivo de texto/imagem sem parametro de formato: ${url.slice(-40)}`);
          }
        }
        if (soProbe) {
          try {
            const h = headersDe(item) || {};
            const r = await fetch(url, { headers: { ...h, Range: "bytes=0-1023" } });
            const dead = r.status === 404 || r.status === 410 || r.status === 451;
            if (dead) aponta(chave, caso, item, `link MORTO (HTTP ${r.status}): ${url.slice(0, 60)}`);
          } catch (_) {
            /* rede: nao condena */
          }
        }
      }
      if (process.env.VERBOSO) {
        console.log(`  ${chave.toUpperCase().padEnd(5)} ${caso.titulo.padEnd(20)} ${lista.length} stream(s)`);
      }
    }
  }

  console.log("=".repeat(78));
  if (!PROBLEMAS.length) {
    console.log(`CONTRATO OK — ${totais} streams, nenhum com url/nome/Referer/formato quebrado`);
  } else {
    console.log(`${PROBLEMAS.length} problema(s) de contrato:`);
    for (const p of PROBLEMAS) console.log("  - " + p);
  }
  process.exitCode = PROBLEMAS.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
