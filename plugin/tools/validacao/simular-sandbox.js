// SIMULADOR DO SANDBOX DO NUVIO — roda os bundles de `dist/` no ambiente do aparelho.
//
// POR QUE ISTO EXISTE: o runtime do Nuvio NAO e' Node. Ele e' um motor JS embarcado
// com uma lista fechada do que existe (ver `plugin/CONTRATO.md`), e um bundle que roda
// na maquina de desenvolvimento pode quebrar no aparelho sem quebrar nenhum teste: o
// `require` so' aceita `cheerio*` e `crypto-js`, `Buffer` nao existe, `process` nao
// existe, o corpo de cada resposta e' cortado em 1 MB e a invocacao morre em 60 s.
//
// Um teste com `require()` normal passa o que o aparelho nunca vai executar. Este
// arquivo executa o MESMO arquivo do `dist/` com um `require` que lanca em qualquer
// coisa fora da lista, sem `process`/`Buffer`, e com o teto de corpo e de tempo do
// contrato. O que passa aqui e o que roda no celular e no computador.
//
// O QUE ISTO NAO SIMULA (e o que medir de verdade no aparelho):
//   * o motor: QuickJS no celular pode ser mais estrito que o V8 do Node em alguns
//     cantos. O `node --check` de cada bundle cobre sintaxe, nao semantica de motor.
//   * rede e TLS reais do aparelho.
//   * o cache HTTP do OkHttp em disco (50 MB), que segue os cabecalhos da origem.
//
// USO: node tools/validacao/simular-sandbox.js [fonte...]        (sem argumento = todas)

"use strict";
const fs = require("fs");
const path = require("path");
const { RAIZ } = require("../_caminhos");
const vm = require("vm");

const fontes = require("../../src/core/fontes");
const { TETO_CORPO_BYTES, TEMPO_FETCH_MAX_MS } = require("../../src/core/sandbox");

const DIST = path.join(RAIZ, "dist");

// A allowlist do `require` do CONTRATO. Qualquer coisa fora daqui LANCA — que e'
// exatamente o comportamento do aparelho, e o que este simulador precisa reproduzir.
const REQUIRE_PERMITIDO = /^(cheerio|crypto-js)(\/.*)?$/;
const MODULOS_FALSOS = {
  cheerio: () => {
    throw new Error("cheerio real exige DOM: o aparelho resolve isto, o simulador nao");
  },
  "crypto-js": () => {
    throw new Error("crypto-js real exige crypto do motor: o aparelho resolve isto, o simulador nao");
  }
};

function requireRestrito(id) {
  const limpo = String(id || "");
  if (REQUIRE_PERMITIDO.test(limpo)) return MODULOS_FALSOS[limpo.split("/")[0]]();
  const erro = new Error(`require("${limpo}") nao existe no runtime do Nuvio`);
  erro.code = "MODULE_NOT_FOUND";
  throw erro;
}

// Um `fetch` que aplica os TETOS do contrato: corpo cortado em 1 MB, um `AbortController`
// de verdade no `signal`, e nenhuma propriedade que o aparelho nao tem. O `Response` e' o
// do Node, entao o resto do codigo (`.text()`, `.json()`, `.arrayBuffer()`) segue igual.
function fetchComTetos(chamadas) {
  return async function fetchSandbox(url, init) {
    const alvo = String(url);
    const opcoes = init || {};
    const ms = Number(chamadas.find((c) => c.url === alvo)?.ms) || 8000;
    const ctrl = new AbortController();
    const sinal = opcoes.signal || ctrl.signal;
    const relogio = setTimeout(() => ctrl.abort(), ms);
    try {
      const real = await fetch(alvo, Object.assign({}, opcoes, { signal: sinal }));
      const buf = Buffer.from(await real.arrayBuffer());
      const cortado = buf.byteLength > TETO_CORPO_BYTES;
      // O aparelho CORTA: o corpo chega menor que o original e o status continua 200.
      // E' esse corte silencioso que produziu "JSON invalido" na leitura de catalogo de
      // painel de 4,7 MB — por isso o simulador devolve os bytes cortados, nao um erro.
      const corpo = cortado ? buf.subarray(0, TETO_CORPO_BYTES) : buf;
      return new Response(corpo, {
        status: real.status,
        statusText: real.statusText,
        headers: real.headers
      });
    } finally {
      clearTimeout(relogio);
    }
  };
}

// O contexto e um `vm` sem prototipo herdado do Node: e' um objeto novo com o que o aparelho
// oferece. Se algum codigo chegar em `process`, `Buffer`, `require` de modulo proibido,
// `__dirname` ou `global` (o `global` do Node), aqui da `undefined` ou lanca — que e' a
// falha que o aparelho da.
function contextoDe(chave) {
  const sandbox = {
    fetch: fetchComTetos([]),
    AbortController,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    JSON,
    Math,
    Date,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Symbol,
    Proxy,
    Reflect,
    BigInt,
    atob: (s) => Buffer.from(String(s), "base64").toString("binary"),
    btoa: (s) => Buffer.from(String(s), "binary").toString("base64"),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    require: requireRestrito,
    TMDB_API_KEY: (() => {
      try {
        const t = fs.readFileSync(path.join(RAIZ, "config", "tmdb.js"), "utf8");
        const m = t.match(/TMDB_API_KEY\s*[:=]\s*["']([0-9a-zA-Z_-]{20,})["']/);
        return m ? m[1] : null;
      } catch (_) {
        return null;
      }
    })(),
    SCRAPER_ID: chave,
    SCRAPER_SETTINGS: {}
  };
  sandbox.globalThis = sandbox;
  return vm.createContext(sandbox, { name: `nuvio:${chave}`, codeGeneration: { strings: false, wasm: false } });
}

// O runtime do Nuvio carrega o bundle como CommonJS (o CONTRATO exige CommonJS), entao
// `module` e `exports` EXISTEM la. O que nao existe e' o resto do Node. Sem estes dois o
// bundle morre no topo com "module is not defined" — que e' um erro do simulador, nao do
// plugin.
function contextoComModule(chave) {
  const ctx = contextoDe(chave);
  const mod = { exports: {} };
  ctx.module = mod;
  ctx.exports = mod.exports;
  return { ctx, mod };
}

// O `codeGeneration.strings: false` desliga `eval` e `new Function` — e' o mesmo engine
// desligado que o CONTRATO descreve. Se algum bundle precisar de `new Function`, ele
// estoura aqui como estouraria no aparelho.
function carrega(chave) {
  const arquivo = path.join(DIST, fontes.bundleDe(chave));
  if (!fs.existsSync(arquivo)) return { erro: `bundle ausente: ${fontes.bundleDe(chave)}` };
  const codigo = fs.readFileSync(arquivo, "utf8");
  const { ctx, mod } = contextoComModule(chave);
  try {
    vm.runInContext(codigo, ctx, { filename: fontes.bundleDe(chave), timeout: 5000 });
  } catch (e) {
    return { erro: `carregou e morreu no topo: ${e && e.message}` };
  }
  // O bundle faz `module.exports = ...` ou mistura `exports.getStreams`; os dois aparecem
  // no codigo real, entao os dois sao lidos.
  const saida = mod.exports && Object.keys(mod.exports).length ? mod.exports : ctx.exports;
  if (!saida || typeof saida.getStreams !== "function") {
    return { erro: `o bundle carregou mas nao exporta getStreams (exports tem: ${Object.keys(saida || {}).join(", ") || "nada"})` };
  }
  // Deixa `getStreams` alcancavel pelo `vm.runInContext` da proxima etapa, que roda como
  // uma expressao do contexto e nao enxerga `mod`.
  vm.runInContext("globalThis.__getStreams = module.exports.getStreams;", ctx);
  return { mod, ctx };
}

function conformidade(codigo) {
  // O que o CONTRATO proibe e o que o aparelho realmente nao tem. Cada item e' uma
  // checagem de TEXTO no bundle: o aparelho nao tem essa(global|modulo), entao um
  // bundle que a menciona esta errado mesmo que o caminho nunca seja exercitado hoje.
  const proibidos = [
    [/\brequire\s*\(\s*["'](fs|path|http|https|net|os|crypto|stream|zlib|child_process|worker_threads|url)["']\s*\)/, "require de modulo Node"],
    [/\bprocess\s*\.\s*(env|argv|exit|cwd|platform)/, "acesso a process"],
    [/\bBuffer\s*\.\s*(from|alloc|isBuffer|concat)/, "Buffer (nao existe no runtime)"],
    [/\b__dirname\b|\b__filename\b/, "__dirname/__filename"],
    [/\bWebAssembly\b/, "WebAssembly (morto no runtime)"],
    [/\bDecompressionStream\b/, "DecompressionStream (ausente no motor embarcado)"],
    [/\bnew\s+Function\s*\(/, "new Function (codeGeneration desligado)"],
    [/\bdocument\s*\.\s*(createElement|querySelector|getElementById)/, "DOM"],
    [/\bnavigator\s*\.\s*(userAgent|platform)/, "navigator (o aparelho nao expoe)"],
    [/\blocalStorage\b|\bsessionStorage\b/, "storage local"]
  ];
  const achados = [];
  for (const [re, nome] of proibidos) if (re.test(codigo)) achados.push(nome);
  return achados;
}

const pedidas = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const lista = pedidas.length ? pedidas.filter((c) => fontes.FONTES[c]) : fontes.chaves();
const IGNORAR_REDE = process.argv.includes("--sem-rede");

(async () => {
  console.log(`[sandbox] simulando o runtime do Nuvio sobre dist/ (${lista.length} fonte(s))`);
  console.log(`[sandbox] sem process, sem Buffer, sem modulos Node, sem DOM, sem eval, corpo <= ${TETO_CORPO_BYTES} B, teto ${TEMPO_FETCH_MAX_MS / 1000} s`);
  console.log("");

  let falhas = 0;
  for (const chave of lista) {
    const nome = fontes.bundleDe(chave);
    const arquivo = path.join(DIST, nome);
    if (!fs.existsSync(arquivo)) {
      console.log(`  ${chave.padEnd(5)} FALHA  bundle ausente (rode \`npm run build\`)`);
      falhas += 1;
      continue;
    }
    const codigo = fs.readFileSync(arquivo, "utf8");

    // 1. O QUE O APARELHO NAO TEM. Antes de executar, porque um bundle que usa uma global
    //    inexistente pode passar adiante enquanto este caminho nao for exercitado.
    const proibidos = conformidade(codigo);
    if (proibidos.length) {
      console.log(`  ${chave.padEnd(5)} FALHA  usa o que o runtime nao tem: ${proibidos.join(", ")}`);
      falhas += 1;
      continue;
    }

    // 2. CARREGAR no contexto do aparelho: e' onde `require` de Node estouraria.
    const carregado = carrega(chave);
    if (carregado.erro) {
      console.log(`  ${chave.padEnd(5)} FALHA  ${carregado.erro}`);
      falhas += 1;
      continue;
    }

    // 3. CHAMAR `getStreams` de verdade, com o teto do contrato. E' o teste que importa:
    //    um bundle pode carregar e estourar na primeira chamada.
    if (IGNORAR_REDE) {
      console.log(`  ${chave.padEnd(5)} ok     carrega no sandbox e exporta getStreams (rede nao exercitada)`);
      continue;
    }
    const casos = { shg: [30984, "tv", 1, 1], ron: [30984, "tv", 1, 1], atb: [30984, "tv", 1, 1], ise: [30984, "tv", 1, 1], san: [30984, "tv", 1, 1], rtd: [30984, "tv", 1, 1], blz: [603, "movie"], spc: [550, "movie"], ato: [603, "movie"], dgo: [94796, "tv", 1, 1] };
    const c = casos[chave] || [603, "movie"];
    const t0 = Date.now();
    let lista2 = null;
    let erro = null;
    try {
      const corrida = vm.runInContext(
        `(async () => await __getStreams(${JSON.stringify(c[0])}, ${JSON.stringify(c[1])}, ${c[2] === undefined ? "null" : c[2]}, ${c[3] === undefined ? "null" : c[3]}))()`,
        carregado.ctx,
        { timeout: TEMPO_FETCH_MAX_MS }
      );
      lista2 = await Promise.race([
        corrida,
        new Promise((_, recusa) => setTimeout(() => recusa(new Error(`estourou os ${TEMPO_FETCH_MAX_MS / 1000}s do contrato`)), TEMPO_FETCH_MAX_MS))
      ]);
    } catch (e) {
      erro = String((e && e.message) || e);
    }
    const ms = Date.now() - t0;
    if (erro) {
      console.log(`  ${chave.padEnd(5)} FALHA  getStreams: ${erro.slice(0, 90)}`);
      falhas += 1;
      continue;
    }
    if (!Array.isArray(lista2)) {
      console.log(`  ${chave.padEnd(5)} FALHA  devolveu ${typeof lista2}, nao lista`);
      falhas += 1;
      continue;
    }
    // O contrato do app: o objeto que o `LocalScraperResult` (data class do Moshi) vai
    // ler. Campo a mais no STREAM quebra o parse em runtime — e o `motivos` tem que estar
    // na LISTA, nunca no stream.
    const ACEITOS = new Set(["name", "title", "description", "url", "quality", "size", "language", "provider", "type", "seeders", "peers", "infoHash", "headers", "subtitles"]);
    const fora = lista2.flatMap((s) => Object.keys(s || {}).filter((k) => !ACEITOS.has(k)));
    if (fora.length) {
      console.log(`  ${chave.padEnd(5)} FALHA  campo que o LocalScraperResult nao tem: ${[...new Set(fora)].join(", ")}`);
      falhas += 1;
      continue;
    }
    if (lista2.length && lista2.some((s) => !/^https?:\/\//i.test(String(s.url || "")))) {
      console.log(`  ${chave.padEnd(5)} FALHA  devolveu url que nao e' http(s)`);
      falhas += 1;
      continue;
    }
    const q = lista2.filter((s) => s && s.quality).length;
    console.log(`  ${chave.padEnd(5)} ok     ${lista2.length} stream(s), ${q} com quality, ${ms} ms`);
  }

  console.log("");
  console.log(falhas ? `[sandbox] ${falhas} fonte(s) com problema` : "[sandbox] todas as fontes carregam, respondem e respeitam o contrato do aparelho");
  process.exit(falhas ? 1 : 0);
})();
