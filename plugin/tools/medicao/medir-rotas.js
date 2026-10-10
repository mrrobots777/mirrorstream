#!/usr/bin/env node
// MEDE O TEMPO DE CADA ROTA: origem direta contra worker de borda.
//
// POR QUE ISTO EXISTE: o projeto decide rota em DOIS lugares — `src/lib/http.js` (reserva
// depois de 403/408/429/5xx) e `src/lib/painel.js` (corrida, escalate em 2,5 s) — e a
// politica escrita é "origem direto primeiro, worker como fallback". Essa politica foi
// escrita por MEDICAO de disponibilidade (o worker so' entra quando a origem recusa), mas
// NUNCA por medicao de velocidade: em nenhum arquivo do projeto existe um numero de
// "a borda responde em X ms contra Y ms da origem". Sem esse numero, "fallback" e so uma
// palavra, e ninguem sabe se a reserva custa 200 ms ou 20 s de espera no aparelho.
//
// O QUE ESTE ARQUIVO MEDE, E O QUE NAO MEDE:
//   MEDE: tempo ate o primeiro byte (ttfb), tempo total, bytes recebidos, status e o
//         cabecalho `x-mirror-cache`, em N repeticoes, para a MESMA URL pelas DUAS rotas.
//   NAO MEDE: a latencia real do aparelho. Isto roda de um IP de datacenter; o Nuvio roda
//         de IP residencial, que e' justamente o caso em que a origem recusa e o worker
//         salva. Os numeros aqui sao sobre o SERVIDOR DE MEDICAO, nao sobre o celular.
//
// A leitura honesta do resultado: quando a origem responde 200, a pergunta "vale a pena ir
// pela borda?" e' sobre preco de latencia, e a resposta muda por regiao e por plano. Quando
// a origem responde 403/451/429, a borda nao e' alternativa mais rapida — e' a UNICA rota,
// e o tempo dela e' o tempo do usuario.
//
// USO:
//   node tools/medicao/medir-rotas.js                       # todas as URLs embutidas
//   node tools/medicao/medir-rotas.js --n=5                 # 5 repeticoes por rota
//   node tools/medicao/medir-rotas.js --url=<url> [--ref=<referer>] [--range=bytes=0-65535]
//   node tools/medicao/medir-rotas.js --json                # saida em JSON (para comparar execucoes)

"use strict";
const path = require("path");
const fontes = require("../../src/core/fontes");
const { WORKER_POR_HOST, workerDe } = require("../../src/core/politica");
const { UA } = require("../../src/lib/ua");
const { PADRAO, chaveTmdb } = require("./casos");

// As URLs sao as que o plugin REALMENTE pede. Os hosts de painel (BLZ/SPC/ATO) nao entram
// aqui de proposito: a credencial deles esta no repo e a URL muda a cada consulta, entao a
// medicao delas e' o `npm run monitorar`, que ja chama os paineis de verdade.
const ALVOS = [
  { fonte: "rtd", nome: "play-link (API, precisa de Referer)", url: "https://redetoonstv.win/api/play-link?contract=3&tmdbId=tt0133093&type=tv&season=1&episode=1", ref: "https://redetoons.win/" },
  { fonte: "rtd", nome: "catalog-index (174 KB)", url: "https://redetoonstv.win/api/catalog-index", ref: "https://redetoons.win/" },
  { fonte: "ise", nome: "API (busca)", url: "https://www.ryuneko.lol/novok3", ref: "https://www.ryuneko.lol/" },
  { fonte: "san", nome: "API (episodios)", url: "https://api.animestvs.org/", ref: "" },
  { fonte: "aon", nome: "API (host com worker mapeado)", url: "https://animesonline.io/", ref: "" },
  { fonte: "atb", nome: "site (host com worker mapeado)", url: "https://www.anitube.biz/", ref: "" },
  { fonte: "dgo", nome: "pagina do catalogo", url: "https://www.doramogo.net/", ref: "" }
];

// O QUE O PLAYER SENTE e' isto, nao a API: um `Range` de N KB no arquivo de video. A API
// dizer "200 em 120 ms" nao diz nada sobre o video abrir — o que decide a sensacao de
// velocidade e' quantos bytes o aparelho puxa por segundo do CDN, e por isso o `kB/s`.
//
// A URL de midia NAO e' escrita aqui. MEDIDO 08/10/2026: um link escrito a mao mede o
// item que ele apontava, nao a fonte. O do RTD, por exemplo, expirou entre a escrita do
// alvo e a execucao e respondeu 403 — o script teria reportado "a borda e' lenta" sem
// nunca ter.mediacido a borda. Por isso cada alvo e' resolvido por `getStreams` AGORA, do
// mesmo `dist/` que o aparelho carrega, e o `Referer` que a fonte pediu e' o que vai junto.
const MEDIAS = [
  { fonte: "rtd", nome: "MP4 do CDN", hls: false },
  { fonte: "shg", nome: "MP4 do CDN", hls: false },
  { fonte: "ise", nome: "MP4 do CDN", hls: false },
  { fonte: "san", nome: "MP4 do CDN", hls: false },
  { fonte: "ato", nome: "MP4 do painel", hls: false },
  { fonte: "dgo", nome: "HLS: manifest + 1o segmento", hls: true },
  { fonte: "atb", nome: "HLS: master + 1o segmento", hls: true }
];

// Resolve a URL de midia pelo caminho REAL do aparelho: `getStreams` do bundle de `dist/`.
// `headers` volta junto porque o plugin entrega `Referer`/`User-Agent` por stream (o ATO,
// MEDIDO 07/10, so' responde 302 com `User-Agent`), e medir sem eles mede um 403 que o
// aparelho nunca vera.
async function resolveMidia(alvo) {
  const mod = require(path.join(process.cwd(), "dist", fontes.bundleDe(alvo.fonte)));
  const lista = await mod.getStreams(...PADRAO[alvo.fonte]);
  const stream = Array.isArray(lista) ? lista[0] : null;
  if (!stream || !stream.url) return null;
  const url = typeof stream.url === "object" && stream.url ? stream.url.url : stream.url;
  return { url: String(url), headers: stream.headers || {}, qualidade: stream.quality || "-" };
}

// O tamanho do `Range` e' o que decide a leitura. 1 MB e' grande demais para ser uma
// amostra honesta (mede a banda larga da maquina de teste) e 2 KB e' pequeno demais para
// medir vazão (mede so o handshake). 512 KB fica no meio: da tempo de medir kB/s sem
// baixar o filme inteiro.
const BYTES_MEDIA = 524288;

function arg(chave, padrao) {
  const achado = process.argv.find((a) => a.startsWith(`--${chave}=`));
  return achado ? achado.slice(chave.length + 3) : padrao;
}

const N = Math.max(1, Number(arg("n", "3")) || 3);
const SAIDA_JSON = process.argv.includes("--json");
const RANGE = arg("range", "");
const URL_UNICA = arg("url", "");
const REF_UNICA = arg("ref", "");
const PAUSA_MS = 400;

if (chaveTmdb() && !globalThis.TMDB_API_KEY) globalThis.TMDB_API_KEY = chaveTmdb();

function alvos() {
  if (URL_UNICA) return [{ fonte: "manual", nome: "URL dada na linha de comando", url: URL_UNICA, ref: REF_UNICA }];
  return ALVOS.filter((a) => fontes.FONTES[a.fonte]);
}

// O `workerDe` do projeto e' a FONTE DA VERDADE de qual host tem reserva: se este script
// montasse a URL do worker com uma tabela propria, mediria uma rota que o plugin nunca usa.
// `workerDe` tambem e' quem decide nao existir reserva — e "sem reserva" e' um resultado
// legitimo desta medicao, nao um erro.
function rotaDeBorda(alvo) {
  return workerDe(alvo.url, alvo.ref);
}

async function mede(url, cabecalhos) {
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), 20000);
  const inicio = process.hrtime.bigint();
  let ttfb = null;
  const ehM3u8 = /\.m3u8(\?|$)/i.test(url);
  try {
    const res = await fetch(url, { headers: cabecalhos, signal: ctrl.signal, redirect: "follow" });
    if (ttfb === null) ttfb = Number(process.hrtime.bigint() - inicio) / 1e6;
    const buf = res.status === 200 || res.status === 206 ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
    const total = Number(process.hrtime.bigint() - inicio) / 1e6;
    return {
      status: res.status,
      ttfb: Math.round(ttfb),
      total: Math.round(total),
      bytes: buf.length,
      kbTotal: Math.round(buf.length / 1024),
      // O corpo em texto so e' guardado para a etapa HLS (que precisa achar o primeiro
      // segmento) e some na medicao: um manifest de 20 KB dentro do JSON de saida seria
      // ruido, e um MP4 de 512 KB seria um arquivo de relatorio.
      corpo: ehM3u8 ? buf.toString("utf8").slice(0, 64 * 1024) : "",
      cache: res.headers.get("x-mirror-cache") || "-",
      erro: ""
    };
  } catch (e) {
    const total = Number(process.hrtime.bigint() - inicio) / 1e6;
    return { status: 0, ttfb: Math.round(ttfb === null ? total : ttfb), total: Math.round(total), bytes: 0, kbTotal: 0, corpo: "", cache: "-", erro: String((e && e.message) || e).slice(0, 60) };
  } finally {
    clearTimeout(relogio);
  }
}

// A mediana e o numero honesto para comparar duas rotas: a primeira repeticao paga DNS e
// TLS, e a media carrega qualquer pico de uma unica chamada. O minimo e' o "melhor caso
// possivel", que e' o que o aparelho ve quando o cache do OkHttp ja esta quente.
// O HLS NAO E' um arquivo: o player pede o manifest (`.m3u8`) e depois os segmentos. Medir
// so o manifest mede uma metada, entao o alvo HLS e' medido em DUAS etapas — o manifest e
// o primeiro segmento real, que e' o byte que o player ve aparecer na tela. O segmento vem
// do proprio manifest (a linha que nao comeca com `#`), porque um caminho montado a mao
// estaria medindo um CDN que pode nem ser o do video.
async function medeHls(alvo) {
  const cab = Object.assign({ "User-Agent": UA }, alvo.headers || {});
  const m = await mede(alvo.url, cab);
  if (m.status !== 200 || !m.corpo) return { manifest: m, segmento: null, master: null };
  // `/index.m3u8` de um master aponta para outra playlist — nesse caso o que o player
  // carrega primeiro e' a variante, e medir o master mediria uma indirection a mais.
  const linhas = m.corpo.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!linhas.length) return { manifest: m, segmento: null, master: null };
  const primeira = new URL(linhas[0], alvo.url).href;
  if (/\.m3u8(\?|$)/i.test(primeira)) {
    const v = await mede(primeira, cab);
    const linhas2 = (v.corpo || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const seg = linhas2.length ? await mede(new URL(linhas2[0], primeira).href, Object.assign({}, cab, { Range: `bytes=0-${BYTES_MEDIA - 1}` })) : null;
    return { manifest: m, master: { url: primeira, ...v, corpo: undefined }, segmento: seg };
  }
  const seg = await mede(primeira, Object.assign({}, cab, { Range: `bytes=0-${BYTES_MEDIA - 1}` }));
  return { manifest: m, master: null, segmento: seg };
}

function resumo(amostras) {
  const ok = amostras.filter((a) => !a.erro);
  const num = (campo) => {
    const v = ok.map((a) => a[campo]).filter((x) => x !== null && x !== undefined).sort((x, y) => x - y);
    if (!v.length) return null;
    return v[Math.floor(v.length / 2)];
  };
  const statuses = [...new Set(amostras.map((a) => `${a.status}${a.erro ? "!" : ""}`))];
  // kB/s pela MEDIANA do total. A primeira amostra paga DNS+TLS e por isso sempre reporta a
  // rota mais lenta do que ela e' — a mediana tira esse efeito sem esconder a variacao.
  const kbTotal = num("kbTotal");
  return {
    n: amostras.length,
    comErro: amostras.length - ok.length,
    status: statuses.join("/"),
    ttfbMediana: num("ttfb"),
    ttfbMin: ok.length ? Math.min(...ok.map((a) => a.ttfb)) : null,
    totalMediana: num("total"),
    bytes: ok.length ? Math.max(...ok.map((a) => a.bytes)) : 0,
    kbTotal,
    cache: [...new Set(ok.map((a) => a.cache))].join("/")
  };
}

const cabDireto = (alvo) => Object.assign({ "User-Agent": UA }, alvo.ref ? { Referer: alvo.ref } : {}, RANGE ? { Range: RANGE } : {});
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const lista = alvos();
  if (!lista.length) {
    console.log("nenhum alvo: as fontes em ALVOS nao estao no registro (rode `npm run build`)");
    process.exit(1);
  }
  const relatorio = [];

  for (const alvo of lista) {
    const borda = rotaDeBorda(alvo);
    const cabecalhos = cabDireto(alvo);
    const dDireta = [];
    const dBorda = [];
    for (let i = 0; i < N; i += 1) {
      dDireta.push(await mede(alvo.url, cabecalhos));
      if (borda) dBorda.push(await mede(borda, Object.assign({}, RANGE ? { Range: RANGE } : {})));
      if (i + 1 < N) await espera(PAUSA_MS);
    }
    const direta = resumo(dDireta);
    const b = borda ? resumo(dBorda) : null;
    relatorio.push({ fonte: alvo.fonte, nome: alvo.nome, url: alvo.url, worker: borda || null, direta, borda: b });

    if (!SAIDA_JSON) {
      const linha = (rotulo, r) => (r ? `${rotulo.padEnd(7)} ${String(r.status).padEnd(5)} ttfb ${String(r.ttfbMediana === null ? "-" : r.ttfbMediana).padStart(6)}ms  total ${String(r.totalMediana === null ? "-" : r.totalMediana).padStart(6)}ms  bytes ${String(r.bytes).padStart(7)}  cache ${r.cache}${r.comErro ? `  (${r.comErro}/${r.n} erro)` : ""}` : "");
      console.log(`\n${alvo.fonte.toUpperCase()} — ${alvo.nome}`);
      console.log(`  ${alvo.url.slice(0, 96)}`);
      if (!borda) console.log("  BORDA   sem reserva: este host nao esta em WORKER_POR_HOST — o plugin cairia so na origem");
      console.log(`  ${linha("DIRETA", direta)}`);
      console.log(`  ${linha("BORDA", b)}`);
    }
  }

  // ETAPA 2 — MIDIA. Separada da etapa 1 porque sao perguntas diferentes: a etapa 1 diz se a
  // borda COMPENSA como rota de API (latencia de metadado), a etapa 2 diz se ela compensa
  // para o ARQUIVO (vazao). Sao numeros que podem discordar, e e' justamente a discordancia
  // que decide se vale fazer proxy de video pelo worker — que a propria MONITORAMENTO.md
  // lista como risco (item 4: "fazer proxy do video inteiro aumenta custo e latencia").
  if (!SAIDA_JSON) console.log("\n=== MIDIA (o que o player sente) ===");
  for (const alvo of MEDIAS.filter((a) => fontes.FONTES[a.fonte])) {
    const bruta = alvo.url ? alvo : await resolveMidia(alvo).catch(() => null);
    if (!bruta) {
      if (!SAIDA_JSON) console.log(`\n${alvo.fonte.toUpperCase()} — ${alvo.nome}\n  sem URL: getStreams nao devolveu stream para ${PADRAO[alvo.fonte].join(", ")}`);
      relatorio.push({ fonte: alvo.fonte, nome: alvo.nome, midia: { erro: "getStreams nao devolveu stream" } });
      continue;
    }
    const borda = rotaDeBorda(bruta);
    const cab = Object.assign({ "User-Agent": UA }, bruta.headers || {});
    const cabMidia = Object.assign({}, cab, { Range: `bytes=0-${BYTES_MEDIA - 1}` });

    const aplicaRange = (r) => (r ? Object.assign({}, r, { corpo: undefined }) : null);
    let direta = null;
    let pelaBorda = null;
    if (alvo.hls) {
      const d = await medeHls(bruta);
      direta = { manifest: aplicaRange(d.manifest), master: aplicaRange(d.master), segmento: aplicaRange(d.segmento) };
    } else {
      const amostras = [];
      for (let i = 0; i < N; i += 1) {
        amostras.push(await mede(bruta.url, cabMidia));
        if (i + 1 < N) await espera(PAUSA_MS);
      }
      direta = { faixa: resumo(amostras) };
    }
    // O `Range` vai JUNTO para a borda: sem ele o worker puxa o arquivo INTEIRO do CDN e
    // devolve, e a medicao passaria a cronometrar o download completo em vez do mesmo
    // primeiro bloco que a rota direta leu. Seriam duas medicoes de coisas diferentes.
    if (borda) {
      if (alvo.hls) {
        const d = await medeHls(Object.assign({}, bruta, { url: borda }));
        pelaBorda = { manifest: aplicaRange(d.manifest), master: aplicaRange(d.master), segmento: aplicaRange(d.segmento) };
      } else {
        const amostras = [];
        for (let i = 0; i < N; i += 1) {
          amostras.push(await mede(borda, cabMidia));
          if (i + 1 < N) await espera(PAUSA_MS);
        }
        pelaBorda = { faixa: resumo(amostras) };
      }
    }
    relatorio.push({ fonte: alvo.fonte, nome: alvo.nome, url: bruta.url, qualidade: bruta.qualidade || null, worker: borda || null, midia: { direta, borda: pelaBorda } });

    if (SAIDA_JSON) continue;
    const SEM_RESERVA = "sem reserva: o CDN deste item nao esta na allowlist — e' uma rota que o plugin nem tenta";
    // A faixa de MP4 chega aqui como o RESUMO de N amostras (mediana), enquanto o segmento
    // HLS chega como UMA amostra. Os dois precisam da mesma linha, entao a funcao normaliza
    // os dois formatos em vez de o chamador ter de saber qual esta passando.
    const kb = (r) => (r && r.totalMediana === null ? "" : r && r.total ? `${Math.round(r.bytes / 1024 / (r.total / 1000))} kB/s` : `${Math.round((r.totalMediana || 0) / 100 * (r.bytes / 1024))} kB/s`);
    const linhaSeg = (rotulo, r, agregado) => {
      if (!r) return `  ${rotulo.padEnd(7)} ${SEM_RESERVA}`;
      if (agregado) {
        if (r.status !== "200/206" && !/^(200|206)/.test(r.status)) return `  ${rotulo.padEnd(7)} status ${r.status.padEnd(4)} — o item deste alvo nao respondeu midia (ver o status antes de comparar rota)`;
        return `  ${rotulo.padEnd(7)} ${String(r.bytes).padStart(7)} B em ${String(r.totalMediana).padStart(6)}ms  ${kb({ total: r.totalMediana, bytes: r.bytes }).padStart(11)}  ttfb ${String(r.ttfbMediana).padStart(5)}ms  cache ${r.cache}${r.comErro ? `  (${r.comErro}/${r.n} erro)` : ""}`;
      }
      if (r.status !== 200 && r.status !== 206) return `  ${rotulo.padEnd(7)} status ${String(r.status).padEnd(4)} ${String(r.bytes).padStart(7)} B — o item deste alvo nao respondeu midia (ver o status antes de comparar rota)`;
      return `  ${rotulo.padEnd(7)} status ${String(r.status).padEnd(4)} ${String(r.bytes).padStart(7)} B em ${String(r.total).padStart(6)}ms  ${kb(r).padStart(11)}  ttfb ${String(r.ttfb).padStart(5)}ms  cache ${r.cache}`;
    };
    console.log(`\n${alvo.fonte.toUpperCase()} — ${alvo.nome}${bruta.qualidade && bruta.qualidade !== "-" ? ` (${bruta.qualidade})` : ""}`);
    console.log(`  ${bruta.url.slice(0, 100)}`);
    if (alvo.hls) {
      if (direta.manifest) console.log(`  DIRETA  manifest  ${String(direta.manifest.status).padEnd(4)} ${String(direta.manifest.bytes).padStart(7)} B em ${String(direta.manifest.total).padStart(6)}ms`);
      if (direta.master) console.log(`  DIRETA  master    ${String(direta.master.status).padEnd(4)} ${String(direta.master.bytes).padStart(7)} B em ${String(direta.master.total).padStart(6)}ms`);
      console.log(linhaSeg("DIRETA", direta.segmento));
      if (pelaBorda) {
        if (pelaBorda.manifest) console.log(`  BORDA   manifest  ${String(pelaBorda.manifest.status).padEnd(4)} ${String(pelaBorda.manifest.bytes).padStart(7)} B em ${String(pelaBorda.manifest.total).padStart(6)}ms`);
        console.log(linhaSeg("BORDA", pelaBorda.segmento));
      }
    } else {
      console.log(linhaSeg("DIRETA", direta.faixa, true));
      console.log(linhaSeg("BORDA", pelaBorda && pelaBorda.faixa, true));
    }
  }

  if (SAIDA_JSON) {
    console.log(JSON.stringify(relatorio, null, 2));
  } else {
    console.log("\n[medir] estes numeros sao de um IP de datacenter. O Nuvio roda de IP residencial:");
    console.log("[medir] e' ali que a origem recusa e o worker vira a unica rota, nao a mais rapida.");
  }
})().catch((e) => {
  console.error("LANCOU:", (e && e.stack) || e);
  process.exit(1);
});