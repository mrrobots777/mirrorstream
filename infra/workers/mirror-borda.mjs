// WORKER DE BORDA — coloca os dois addons na borda da Cloudflare.
//
// POR QUE ISTO EXISTE (medido 02/10/2026, de dentro do Brasil, cf-ray GRU)
//
//   /manifest.json                     865B   1,09s
//   /meta/movie/tmdb:603.json          871B   0,60s
//   /catalog/tv/mirror-tv-live.json    110KB  0,27s
//   /api/channels                      140KB  0,45s
//   /nuvio/catalog/channel/tv.json      91KB  0,51s
//
// A origem e' um Dokku atras da Cloudflare, e o cache de borda dela guarda JSON com TTL
// reescrito pela zona do BeamUp (decisao 140: `max-age=14400`). O problema e' que o JSON so
// chega na borda DEPOIS de a origem responder — o primeiro pedido de cada objeto do mundo
// espera o app inteiro, e o `/manifest.json` (que o Stremio le na instalacao) foi medido em
// **1,09s**. Este worker e' a borda: o primeiro pedido vira cache e o resto e' servido de um
// PoP perto de quem perguntou, sem tocar na origem.
//
// O QUE NAO VAI PARA A BORDA, e por que — cada linha aqui e' uma decisao, nao um palpite:
//
// 1. `/stream/*`, `/api/streams/*`, `/nuvio/stream/*`  -> NUNCA. Sao links de video. A
//    decisao 49 separou video do servidor justamente para ele nao guardar coisa de cliente,
//    e o TTL de link assinado nao sobrevive a um cache de borda. Cachear stream e' como
//    devolver o mesmo link expirado para todo mundo.
//
// 2. `/catalog/tv/...` **com `?date=`** -> NUNCA. Medido: **1.132.892 bytes** (1,1MB), contra
//    110KB sem a data. Sao 1,1MB por DIA, com uma chave de cache por dia: a taxa de acerto
//    seria de uma requisicao, e cada dia expulsa o dia anterior da cache. E' o oposto de
//   (edge caching].
//
// 3. Qualquer resposta **>= 400** -> NUNCA. A decisao 140.exists ja foi cobrada: um 404
//    transitorio guardado na borda vira "o addon sumiu" por 4 horas.
//
// 4. `/health`, `/metrics`, `/dashboard` -> NUNCA. Mudam com o tempo; o `/health` ja ficou
//    com uptime congelado uma vez por causa de cache.
//
// 5. `/p2p/*` -> NUNCA. E' relato de telemetria: o corpo e' descartado de proposito.
//
// O que e' `.mjs` e nao `.js`: e' assim que o `import()` do Node consegue carregar este
// arquivo num teste CommonJS (`test/worker-borda.test.js`), que roda sem rede. O Cloudflare
// aceita os dois.

const TTL = {
  manifesto: 300,        // 5 min. Muda em deploy; 5 min e' o preco de um deploy aparecer.
  meta: 900,             // 15 min. Meta de filme nao muda em horas.
  catalogo: 1800,        // 30 min. O catalogo de TV muda quando o REI muda de lista.
  api: 600               // 10 min. /api/channels e' o mesmo dado com outro formato.
};

// Acima disto a Cloudflare nao guarda no `caches.default` de forma confiavel, e um objeto
// de 1MB por dia nao ajuda ninguem. 512KB e' o teto classico do cache de borda.
const TAMANHO_MAXIMO = 512 * 1024;

/**
 * Decide o que fazer com um pedido. Puro: e' o que o teste exercita sem rede.
 *
 * @param {string} pathname  caminho, sem query
 * @param {string} search    query string, comecando em "?" ou vazia
 * @returns {{cache: boolean, ttl: number, chave: string, motivo: string}}
 */
export function classifica(pathname, search = "") {
  const query = new URLSearchParams(search);
  const chave = pathname + (search || "");

  // 1. STREAM — nunca, em nenhuma forma.
  if (/^\/(?:[^/]+\/)?stream\//.test(pathname)) {
    return { cache: false, ttl: 0, chave, motivo: "stream e' link de video" };
  }
  if (/^\/api\/streams\//.test(pathname)) {
    return { cache: false, ttl: 0, chave, motivo: "stream e' link de video" };
  }
  if (/^\/nuvio\/stream\//.test(pathname)) {
    return { cache: false, ttl: 0, chave, motivo: "stream e' link de video" };
  }

  // 2. DIAGNOSTICO E TELEMETRIA — muda com o tempo.
  if (/^\/(health|metrics)$/.test(pathname)) {
    return { cache: false, ttl: 0, chave, motivo: "diagnostico nao se congela" };
  }
  if (/^\/(dashboard|install|tv)$/.test(pathname)) {
    return { cache: false, ttl: 0, chave, motivo: "pagina muda em deploy" };
  }
  if (/^\/p2p\//.test(pathname)) {
    return { cache: false, ttl: 0, chave, motivo: "relato e' descartado de proposito" };
  }

  // 3. O CATALOGO COM DATA — 1,1MB por dia, uma chave por dia (medido).
  if (query.has("date")) {
    return { cache: false, ttl: 0, chave, motivo: "catalogo com date pesa 1,1MB por dia" };
  }

  // 4. O QUE VAI PARA A BORDA.
  if (pathname.endsWith("/manifest.json") || pathname === "/manifest.json") {
    return { cache: true, ttl: TTL.manifesto, chave, motivo: "manifesto" };
  }
  if (/^\/(?:[^/]+\/)?catalog\//.test(pathname) || /^\/nuvio\/catalog\//.test(pathname)) {
    return { cache: true, ttl: TTL.catalogo, chave, motivo: "catalogo" };
  }
  if (/^\/(?:[^/]+\/)?meta\//.test(pathname) || /^\/nuvio\/meta\//.test(pathname)) {
    return { cache: true, ttl: TTL.meta, chave, motivo: "meta" };
  }
  if (/^\/api\//.test(pathname)) {
    return { cache: true, ttl: TTL.api, chave, motivo: "api" };
  }

  // 5. O QUE NAO SEI O QUE E'. Nao cacheia o desconhecido: uma regra de cache e' uma
  //    promessa, e promessa de coisa desconhecida vira link guardado sem querer.
  return { cache: false, ttl: 0, chave, motivo: "rota nao classificada" };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const rota = classifica(url.pathname, url.search);

    // Diagnostico DO WORKER. Nao toca na origem e responde no proprio PoP, que e' a forma de
    // medir se a borda esta viva sem pagar uma ida ate o Dokku.
    if (url.pathname === "/__borda") {
      return json({
        ok: true,
        origem: env.ORIGEM || "(nao configurada)",
        rota,
        worker: "mirror-borda"
      });
    }

    // A ORIGEM. `env.ORIGEM` vem do wrangler.toml (ou do secret), porque o worker precisa
    // saber para ONDE ir: o hostname do request e' o do proprio worker.
    const origem = env.ORIGEM;
    if (!origem) {
      return json({ error: "ORIGEM nao configurada no worker" }, 500);
    }
    const destino = origem.replace(/\/$/, "") + url.pathname + url.search;
    const paraOrigem = new Request(destino, {
      method: request.method,
      headers: request.headers,
      redirect: "manual"
    });

    // POST (p2p/report, admin) nunca e' cacheado e vai direto.
    //
    // MEDIDO 02/10/2026: o `fetch` daqui NAO tinha try/catch, entao uma origem fora do ar
    // fazia o worker LANCAR. Na Cloudflare isso vira erro **1101** ("Worker threw exception") —
    // opaco, sem dizer nada, e nao e' o mesmo que o addon estar fora. Todo caminho que vai
    // direto tem de devolver um erro limpo. O `w.fetch` de teste achou isso: com a origem
    // morta, o pedido de `/stream/tv/…` derrubou o teste com o erro cru, em vez de um 503.
    if (request.method !== "GET" || !rota.cache) {
      let direto;
      try {
        direto = await fetch(paraOrigem);
      } catch (erro) {
        return comMarcador(
          json(
            {
              error: "origem indisponivel",
              detalhe: String((erro && erro.message) || erro),
              rota: rota.motivo,
              dica: "o addon de origem nao respondeu — e' a origem, nao a borda"
            },
            503
          ),
          rota.motivo,
          "ORIGEM-FORA",
          request
        );
      }
      return comMarcador(direto, rota.motivo, "BYPASS", request);
    }

    const cache = caches.default;
    const chave = new Request(url.toString(), { method: "GET" });

    const guardado = await cache.match(chave);
    if (guardado) {
      // STALE-WHILE-REVALIDATE: responde na hora e revalida em segundo plano. O primeiro
      // pedido paga a origem; todo mundo depois paga o PoP. E o `ctx.waitUntil` que segura a
      // promessa — sem ele a Cloudflare pode matar o worker antes de terminar.
      ctx.waitUntil(
        (async () => {
          try {
            const novo = await fetch(paraOrigem);
            if (deixaGuardar(novo)) await cache.put(chave, novo.clone());
          } catch (_) {
            // Origem fora do ar: o guardado continua sendo servido. E' o objetivo do SWR — e o
            // unico lugar onde swallow e' o comportamento certo, porque aqui ja ha resposta.
          }
        })()
      );
      return comMarcador(guardado, rota.motivo, "HIT", request);
    }

    let resposta;
    try {
      resposta = await fetch(paraOrigem);
    } catch (erro) {
      // Cache vazio E origem fora do ar: nao ha o que servir. Erro limpo, nao 1101.
      return comMarcador(
        json({ error: "origem indisponivel", detalhe: String((erro && erro.message) || erro) }, 503),
        rota.motivo,
        "ORIGEM-FORA",
        request
      );
    }
    if (deixaGuardar(resposta)) {
      const copia = resposta.clone();
      // PUT no `waitUntil` tambem: a resposta vai pro cliente agora, o cache enche depois.
      ctx.waitUntil(cache.put(chave, copia).catch(() => {}));
    }
    return comMarcador(resposta, rota.motivo, "MISS", request);
  }
};

/** Erro NUNCA e' guardado (decisao 140: um 404 transitorio na borda vira 4 h de "addon sumiu"). */
export function deixaGuardar(resposta) {
  if (!resposta) return false;
  if (resposta.status >= 400) return false;
  const tipo = resposta.headers.get("content-type") || "";
  if (!/json|text\/plain/.test(tipo)) return false;
  const tam = Number(resposta.headers.get("content-length") || 0);
  if (tam && tam > TAMANHO_MAXIMO) return false;
  return true;
}

function comMarcador(resposta, motivo, estado, request) {
  // `Vary` no Accept-Encoding evita que o gzip do browser sirva o corpo cru de outro.
  const headers = new Headers(resposta.headers);
  headers.set("X-Mirror-Borda", estado);
  headers.set("X-Mirror-Motivo", motivo);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", "X-Mirror-Borda, X-Mirror-Motivo");
  // O cache de borda e' revalidado pelo TTL do worker; o TTL do navegador fica curto para
  // nao hidepor 4 h o que a gente acabou de corrigir.
  if (estado === "HIT" || estado === "MISS") {
    headers.set("Cache-Control", "public, max-age=120");
    headers.set("CDN-Cache-Control", "no-store");
  }
  return new Response(resposta.body, {
    status: resposta.status,
    statusText: resposta.statusText,
    headers
  });
}

function json(objeto, status = 200) {
  return new Response(JSON.stringify(objeto), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}