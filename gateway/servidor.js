"use strict";

// Servidor HTTP do gateway (Task 7, spec §4): as três rotas — GET /resolve-batch,
// GET /health e GET /metrics — em Node puro (`http`), zero dependência npm.
//
// ORDEM DO DESPACHO (fixa): OPTIONS (preflight) → método ≠ GET (405) → caminho.
// Todo caminho, inclusive os erros (400/405/404/500), leva
// `access-control-allow-origin: *` — um 400 bloqueado por CORS aparece no
// aparelho como falha de rede, não como erro de validação (spec §4).
//
// `id` e `type` são validados ANTES de chamar `resolve`: um pedido malformado
// nunca alcança um scraper (spec §11 caso 9). `-` em season/episode — o que o
// app manda para filme — vira `null`, nunca NaN (spec §4, Review Focus 2).
//
// Consumo como biblioteca: `criaServidor(apis) => http.Server`, com
// `apis = { resolve, fontes, estado, cache, metricas }` — `resolve` chega já
// montado (um teste pode trocar por um que lança). Quando o arquivo roda direto
// (`require.main === module`) ele monta a cadeia inteira e escuta em
// `config.PORTA`/`config.HOST`.
const http = require("node:http");

const config = require("./config");
const fontes = require("./fontes");
const { criaResolve } = require("./resolve");
const { criaEstado } = require("./estado");
const { criaCache } = require("./cache");
const { criaMetricas } = require("./metricas");
const stremio = require("./stremio");

// `:` é legal: tmdb:603, tt0903747:1:1 — o defeito do Worker antigo
// (`^[a-zA-Z0-9_-]{2,120}$` rejeitava os dois) não é herdado (spec §4).
const ID_RE = /^[a-zA-Z0-9_:-]{1,120}$/;
const TIPO_RE = /^(movie|tv)$/;

const CORS = { "access-control-allow-origin": "*" };
const SEM_CACHE = { "cache-control": "no-store" };
const TIPO_JSON = "application/json; charset=utf-8";
const TIPO_PROMETHEUS = "text/plain; version=0.0.4; charset=utf-8";

function enviaTexto(res, status, corpo, tipo, extra) {
  res.writeHead(status, {
    ...CORS,
    "content-type": tipo,
    "content-length": Buffer.byteLength(corpo),
    ...extra,
  });
  res.end(corpo);
}

function json(res, corpo, status = 200, extra) {
  enviaTexto(res, status, JSON.stringify(corpo), TIPO_JSON, extra);
}

// `-` (o que o app manda para filme), vazio ou ausente → null; numérico → Number.
// O `-` NUNCA vira NaN: ele chega no resolve como `null` (Review Focus 2).
function inteiroOuNulo(valor) {
  if (valor === null) return null;                 // parâmetro ausente
  const texto = String(valor).trim();
  if (texto === "" || texto === "-") return null;
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

// O que /health e /metrics leem dos módulos injetados (spec §4).
function infoDe(apis) {
  return {
    fontes: {
      total: apis.fontes.total(),
      ativas: apis.fontes.ativas(),
      em_cooldown: apis.estado.emCooldownTotal(),
    },
    cache: {
      positivo: apis.cache.contagem("positivo"),
      negativo: apis.cache.contagem("negativo"),
    },
  };
}

async function roteia(req, res, apis) {
  const url = new URL(req.url, "http://localhost");

  // 1 — preflight primeiro, para qualquer caminho: sem ele o app nem envia o GET.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...CORS,
      "access-control-allow-methods": "GET, OPTIONS",
    });
    res.end();
    return;
  }

  // 2 — só GET passa; qualquer outro método é 405 antes de olhar o caminho.
  if (req.method !== "GET") {
    json(res, { erro: "metodo" }, 405);
    return;
  }

  // 3 — despacho por caminho.
  if (url.pathname === "/resolve-batch") {
    const params = url.searchParams;
    const id = params.get("id");
    if (!id || !ID_RE.test(id)) {
      json(res, { erro: "id invalido" }, 400);
      return;
    }
    const tipo = params.get("type");
    if (!tipo || !TIPO_RE.test(tipo)) {
      json(res, { erro: "type invalido" }, 400);
      return;
    }
    // Validado — só agora um scraper pode ser alcançado.
    const resposta = await apis.resolve({
      id,
      tipo,
      temporada: inteiroOuNulo(params.get("season")),
      episodio: inteiroOuNulo(params.get("episode")),
      preferida: params.get("preferida"),
    });
    json(res, resposta);
    return;
  }

  if (url.pathname === "/health") {
    const info = infoDe(apis);
    json(res, {
      ok: true,
      versao: config.VERSAO,
      uptime_s: Math.floor(process.uptime()),
      fontes: info.fontes,
      cache: info.cache,
    }, 200, SEM_CACHE);
    return;
  }

  if (url.pathname === "/metrics") {
    enviaTexto(res, 200, apis.metricas.render(infoDe(apis)), TIPO_PROMETHEUS, SEM_CACHE);
    return;
  }

  // Superfície Stremio (fora do plano, decisão do dono de 10/10/2026): o
  // BeamUp só publica addons Stremio e o `beamup-lint` recusa qualquer outra
  // coisa no pre-flight. `/manifest.json` é estático; `/stream/...` delega ao
  // MESMO `resolve` de sempre — o consumo real do plugin continua em
  // /resolve-batch, ninguém instala este addon no Stremio.
  if (url.pathname === "/manifest.json") {
    json(res, stremio.manifest);
    return;
  }

  if (url.pathname.startsWith("/stream/")) {
    const caminho = decodeURIComponent(url.pathname.slice("/stream/".length))
      .replace(/\.json$/, "");
    const pedido = stremio.parseiaStream(caminho);
    if (!pedido) { json(res, { erro: "stream invalido" }, 400); return; }
    const resposta = await apis.resolve(pedido);
    const streams = (Array.isArray(resposta.streams) ? resposta.streams : [])
      .map(stremio.paraStremio)
      .filter(Boolean);
    json(res, { streams });
    return;
  }

  json(res, { erro: "rota invalida" }, 404);
}

function criaServidor(apis) {
  return http.createServer((req, res) => {
    roteia(req, res, apis).catch(() => {
      // O try/catch do handler inteiro (spec §4): 500 JSON e o stack nunca
      // chega ao cliente. O sinal observável aqui é o contador
      // `gateway_resolve_total{cache="erro"}` do /metrics — a única entrada
      // do spec que mais ninguém incrementa.
      try { apis.metricas.resolve("erro"); } catch (_) { /* observabilidade não derruba o 500 */ }
      if (res.headersSent) { res.destroy(); return; }   // pior caso: sem headers, não dá pra responder
      json(res, { erro: "interno" }, 500);
    });
  });
}

if (require.main === module) {
  config.carregaEnv();
  const carregadas = fontes.carrega();
  const estado = criaEstado();
  const cache = criaCache();
  const metricas = criaMetricas();
  const resolve = criaResolve({ fontes, estado, cache, metricas, orcaMs: config.ORCA_MS });
  const servidor = criaServidor({ resolve, fontes, estado, cache, metricas });
  servidor.listen(config.PORTA, config.HOST, () => {
    console.log(
      `[gateway] ${config.VERSAO} em http://${config.HOST}:${config.PORTA} — ` +
      `${carregadas.ativas}/${carregadas.total} fontes, orçamento ${config.ORCA_MS} ms`
    );
  });
}

module.exports = { criaServidor };
