// SERVIDOR DE API — as mesmas fontes do plugin Nuvio, expostas por HTTP.
//
// POR QUE EXISTE: o plugin e' um pacote para o app Nuvio (Android) e nao tem como ser
// consultado por fora — o `manifest.json` so' e' lido pelo app, e `getStreams` so' roda
// dentro do runtime dele. Isso torna impossivel (a) integrar o catalogo com outro
// consumidor, (b) rodar a bateria de um servidor em vez do aparelho, e (c) depurar uma
// fonte sem aparelho nenhum.
//
// ESTE servidor NAO REIMPLEMENTA NADA. Ele carrega os mesmos bundles de `dist/` que o
// `build.js` gera para o app (`require('./dist/<fonte>.js')`) e so' traduz par ->
// query string -> chamada. Se uma correcao entra em `src/`, entra aqui no mesmo build:
// nao existe caminho pelo qual a API e o plugin divirjam.
//
// O que ele NAO faz, e por deliberacao:
//   * nao tem catalogo proprio (o TMDB resolve o id, igual o app);
//   * nao guarda estado entre requisicoes (o runtime do app tambem nao guarda);
//   * nao_cacheia stream em disco (o link do painel tem token e expira).
//
// USO:
//   node tools/publicacao/servidor-api.js            # porta 8787
//   PORT=9000 node tools/publicacao/servidor-api.js
//   node tools/publicacao/servidor-api.js --port=9000 --somente=ato,blz
//
// ENDPOINTS (todos JSON, `charset=utf-8`):
//
//   GET /health
//       liveness + quantas fontes carregaram o bundle.
//
//   GET /manifest.json
//       o MESMO manifesto que o plugin publica (Stremio-addon shape: `scrapers[]` com
//       `id`, `name`, `version`, `filename`, `description`, `supportedTypes`).
//
//   GET /fontes
//       o registro: chave, sigla, tipos, conteudos, ativa, motivo da desativacao.
//
//   GET /streams?fonte=<id>&tmdb=<id>&tipo=<movie|tv>[&temporada=N&episodio=N]
//       uma fonte. `fonte` obrigatorio aqui.
//
//   GET /streams?tmdb=<id>&tipo=<movie|tv>[&temporada=N&episodio=N][&fontes=a,b]
//       todas as fontes ATIVAS em paralelo (`fontes=` filtra). Sem `fonte=` o servidor
//       roda as 10 de uma vez — e o que reproduz a tela do app.
//
//   GET /stream/<fonte>/<tmdb>/<tipo>[/<temporada>/<episodio>]
//       atalho em path, para quem prefere o formato de rota.
//
// CÓDIGO DE SAÍDA NO CORPO (não no status HTTP, que é sempre 200 quando a requisição
// mesma foi entendida): `"erro"` por fonte e o que aconteceu com AQUELA fonte. Uma fonte
//que devolveu `[]` tem `"status":"vazio"`, que e' "a fonte nao tem este conteudo" —
// diferente de `"status":"erro"`, que e' "a fonte quebrou". O app distingue os dois e
// esta API tambem: sem isso, um 403 de origem viraria 500 e o consumidor nao saberia
// se a fonte esta quebrada ou so nao tem o titulo.
//
// O `motivo` do `qualifica` (o por que de um `quality` vazio) viaja em
// `motivosDeQualidade`, indexado por `<url>|<headers ordenados>` — a mesma chave que
// `src/lib/qualifica.js` grava. Sem ele o consumidor veria `"quality": null` e nao
// saberia se foi bloqueio, timeout ou origem sem quadro.

const http = require("http");
const path = require("path");
const fs = require("fs");

const fontes = require("../../src/core/fontes");

const { RAIZ } = require("../_caminhos");
const DIST = path.join(RAIZ, "dist");
const ARGV = process.argv.slice(2);

// Aceita o nome em portugues E o abreviado em ingles, porque quem escreve o comando na
// linha digita `--port` e quem le o codigo espera `--porta`. Antes disso o servidor
// ignorava `--port=8795` e subia na 8787 — a prova rodava contra uma porta morta e
// reportava `ECONNREFUSED` como se o servidor nao existisse.
function opcao(...nomes) {
  for (const nome of nomes) {
    const comPrefixo = ARGV.find((a) => a.startsWith(`--${nome}=`));
    if (comPrefixo) return comPrefixo.split("=").slice(1).join("=");
    if (ARGV.includes(`--${nome}`)) return "1";
  }
  return null;
}

// A chave do TMDB: o build a injeta nos bundles, mas o servidor carrega `dist/` e nao
// passa pelo banner do build, entao ela e' lida da mesma fonte que o build usa. Ordem de
// precedencia igual a do `build.js`: ambiente, depois `config/tmdb.js`.
function chaveTmdb() {
  const doAmbiente = process.env.TMDB_API_KEY;
  if (doAmbiente && String(doAmbiente).trim()) return String(doAmbiente).trim();
  for (const padrao of [
    /TMDB_API_KEY\s*\|\|\s*["']([0-9a-fA-F]{20,})["']/,
    /TMDB_API_KEY\s*[:=]\s*["']([0-9a-zA-Z_-]{20,})["']/
  ]) {
    try {
      const m = fs.readFileSync(path.join(RAIZ, "config", "tmdb.js"), "utf8").match(padrao);
      if (m) return m[1];
    } catch (_) {}
  }
  return null;
}

const CHAVE = chaveTmdb();
if (!CHAVE) {
  console.error("[api] TMDB_API_KEY ausente: defina no ambiente ou em config/tmdb.js — sem ela nenhuma fonte resolve titulo.");
  process.exit(1);
}
globalThis.TMDB_API_KEY = CHAVE;

// Os bundles sao carregados uma vez e guardados. `require` ja caches por modulo, entao o
// `Map` existe so para nao repetir o `require` e para podermos relistar as fontes que
// NAO carregaram (bundle faltando = build velho).
const BUNDLES = new Map();
function carrega(chave) {
  if (BUNDLES.has(chave)) return BUNDLES.get(chave);
  const arquivo = path.join(DIST, fontes.bundleDe(chave));
  let mod = null;
  let erro = null;
  try {
    if (!fs.existsSync(arquivo)) throw new Error(`bundle ausente (rode \`npm run build\`): dist/${fontes.bundleDe(chave)}`);
    mod = require(arquivo);
  } catch (e) {
    erro = String((e && e.message) || e);
  }
  BUNDLES.set(chave, { mod, erro });
  return BUNDLES.get(chave);
}

function soInteiro(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

// O status de uma fonte. `erro` e `vazio` sao respostas diferentes de proposito — ver o
// cabecalho. `erro` so aparece quando a fonte LANCA.
function statusDe(lista, erro) {
  if (erro) return "erro";
  if (!Array.isArray(lista)) return "contrato";
  if (!lista.length) return "vazio";
  return "ok";
}

async function streamsDe(chave, tmdb, tipo, temporada, episodio) {
  const t0 = Date.now();
  const { mod, erro } = carrega(chave);
  if (erro) {
    return { fonte: chave, sigla: fontes.sigla(chave), status: "erro", erro, ms: 0, streams: [] };
  }
  let lista = null;
  let lancou = "";
  try {
    lista = await mod.getStreams(tmdb, tipo, temporada, episodio);
  } catch (e) {
    lancou = String((e && e.message) || e);
  }
  const status = statusDe(lista, lancou);
  const out = {
    fonte: chave,
    sigla: fontes.sigla(chave),
    status,
    ms: Date.now() - t0,
    streams: Array.isArray(lista) ? lista : []
  };
  if (lancou) out.erro = lancou;
  // O snapshot de motivos do `qualifica`: sai na LISTA (`lista.motivos`), nunca no stream,
  // porque o `LocalScraperResult` do Nuvio e' data class e campo a mais quebra o parse.
  if (lista && lista.motivos) out.motivosDeQualidade = lista.motivos;
  return out;
}

// Sempre devolve o MESMO formato: sem `fontes=` o filtro e' vazio e a lista e' a de todas
// as ativas. Devolver a lista solta num caminho e' objeto no outro ja quebrou uma vez — o
// `validas` virava `undefined` e o `.map` estourava.
function fontesAtivas(filtro) {
  const todas = fontes.chaves();
  if (!filtro) return { validas: todas, ignoradas: [] };
  const pedidas = String(filtro).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const validas = pedidas.filter((c) => fontes.FONTES[c] && fontes.FONTES[c].ativo !== false);
  const ignoradas = pedidas.filter((c) => !fontes.FONTES[c]);
  return { validas, ignoradas };
}

function json(res, corpo, status = 200) {
  const texto = JSON.stringify(corpo, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(texto),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(texto);
}

function partesDe(url) {
  return String(url || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch (_) {
        return s;
      }
    });
}

async function trata(req, res) {
  const url = new URL(req.url, "http://localhost");
  const rota = partesDe(url.pathname);
  const q = url.searchParams;

  // `GET /streams` e o unico caminho de trabalho; todo o resto e' metadado.
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, { erro: `metodo ${req.method} nao suportado (a API e' de leitura)` }, 405);
  }

  if (!rota.length || rota[0] === "health") {
    const carregadas = [...BUNDLES.entries()].filter(([, v]) => v.mod).map(([k]) => k);
    const quebradas = [...BUNDLES.entries()].filter(([, v]) => v.erro).map(([k, v]) => ({ fonte: k, erro: v.erro }));
    return json(res, {
      ok: quebradas.length === 0,
      fontes: { ativas: fontes.chaves().length, noRegistro: fontes.chavesTodos().length },
      bundles: { carregados: carregadas.length, quebrados: quebradas }
    });
  }

  if (rota[0] === "manifest.json") {
    // O mesmo objeto que o `build.js` escreve em `public/manifest.json`.
    return json(res, fontes.manifesto());
  }

  if (rota[0] === "fontes") {
    return json(res, {
      ativas: fontes.chaves(),
      registro: fontes.chavesTodos().map((c) => {
        const f = fontes.FONTES[c];
        return {
          chave: c,
          sigla: f.sigla,
          descricao: f.descricao,
          tipos: f.tipos.slice(),
          conteudos: f.conteudos.slice(),
          ativa: f.ativo !== false,
          motivo: f.motivo || null
        };
      })
    });
  }

  // `/stream/<fonte>/<tmdb>/<tipo>[/<t>/<e>]`
  let fontePedida = q.get("fonte") || "";
  let tmdb = q.get("tmdb") || "";
  let tipo = q.get("tipo") || "";
  let temporada = soInteiro(q.get("temporada"));
  let episodio = soInteiro(q.get("episodio"));
  let filtroFontes = q.get("fontes") || "";

  if (rota[0] === "stream" && rota.length >= 4) {
    fontePedida = rota[1];
    tmdb = rota[2];
    tipo = rota[3];
    temporada = soInteiro(rota[4]);
    episodio = soInteiro(rota[5]);
  } else if (rota[0] !== "streams") {
    return json(res, { erro: `rota desconhecida: /${rota.join("/")}`, rotas: ["/health", "/manifest.json", "/fontes", "/streams", "/stream/:fonte/:tmdb/:tipo[/:temporada/:episodio]"] }, 404);
  }

  if (!tmdb) return json(res, { erro: "falta ?tmdb=<id do TMDB ou IMDb>" }, 400);
  if (!tipo) tipo = "movie";
  tipo = String(tipo).toLowerCase() === "tv" ? "tv" : "movie";

  let lista;
  if (fontePedida) {
    const chave = String(fontePedida).toLowerCase();
    if (!fontes.FONTES[chave]) {
      return json(res, { erro: `fonte fora do registro: ${fontePedida}`, registro: fontes.chavesTodos() }, 400);
    }
    const reg = fontes.FONTES[chave];
    if (reg.ativo === false) {
      return json(res, {
        fonte: chave,
        sigla: reg.sigla,
        status: "desativada",
        motivo: reg.motivo,
        streams: []
      });
    }
    lista = [await streamsDe(chave, tmdb, tipo, temporada, episodio)];
  } else {
    const { validas, ignoradas } = fontesAtivas(filtroFontes);
    // EM PARALELO: o Nuvio roda 10 scrapers simultaneos com teto de 60 s cada, e a
    // tela so aparece quando todas respondem. Em serie a chamada levaria a soma.
    const respostas = await Promise.all(validas.map((c) => streamsDe(c, tmdb, tipo, temporada, episodio)));
    lista = respostas;
    if (ignoradas.length) {
      return json(res, { erro: `fontes fora do registro ignoradas: ${ignoradas.join(", ")}`, resultados: lista });
    }
  }

  const comStream = lista.filter((r) => r.streams.length).length;
  return json(res, {
    consulta: { tmdb, tipo, temporada, episodio },
    fontes: lista.length,
    comStream,
    resultados: lista
  });
}

const PORTA = Number(opcao("porta", "port")) || Number(process.env.PORT) || 8787;
const HOST = opcao("host") || process.env.HOST || "0.0.0.0";
const SOMENTE = opcao("somente", "fontes") || process.env.FONTES || "";

const server = http.createServer((req, res) => {
  trata(req, res).catch((e) => {
    json(res, { erro: String((e && e.message) || e) }, 500);
  });
});

server.listen(PORTA, HOST, () => {
  const ativas = SOMENTE ? SOMENTE.split(",").filter(Boolean).length : fontes.chaves().length;
  console.log(`[api] MirrorStream em http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORTA}`);
  console.log(`[api] ${ativas} fonte(s) pronta(s) | dist/ carregado de ${path.relative(process.cwd(), DIST) || DIST}`);
  console.log("[api] GET /health | /manifest.json | /fontes | /streams?tmdb=603&tipo=movie");
});