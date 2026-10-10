const EMBED_DOMAINS = ["v2.rdembed.sbs", "w2.rdembed.sbs"];

const ALLOWED_HOSTS = [
  "redetoons.win",
  "www.redetoons.win",
  "redetoonstv.win",
  "www.redetoonstv.win",
  "playerflix.ink",
  "kakito.xyz",
  "206.109.57.195",
  "nixplay.lat",
  "embedtv.lat",
  "telaplay93.top",
  "4x4u29c.autos",
  // MEDIDO 07/10/2026: o painel "Autos" trocou de host e de credencial — o catalogo e'
  // item a item o mesmo (31.677 itens com `stream_id` e nome iguais, e o mesmo
  // `tmdb_id` no detalhe), mas `4x4u29c.autos` saiu do ar (TCP fechado em 80 e 443).
  // O host novo responde a API e a midia, entao entra na lista para o guarda
  // "host not allowed" deixar de barrar o caminho de reserva da fonte ATO.
  "firetvcb.net",
  "cnn.radiogaucha.fun",
  "www.doramogo.net",
  "www.mydoramas.net",
  "anidrive.click",
  "animesonline.io",
  "www.anitube.biz",
  "animesdigital.org",
  "topanimes.net",
  "api.otakulogia.com",
  "nsrv.classotaku.app",
  "web.archive.org",
  "api.allorigins.win",
  // Fontes de anime com MP4 por episodio (MEDIDO 08/10/2026). A API responde direto e o
  // CDN de video tambem — por isso estas entradas sao so a REDE de seguranca: se um IP de
  // datacenter for barrado um dia, o caminho de reserva acende sem novo deploy.
  "www.ryuneko.lol",                        // ISE — API (busca + episodios)
  "anitubehd2.dalayqnwpo.lol",              // ISE — CDN de video (o `fullhd` do payload da 404)
  "anitubefullhd.dalayqnwpo.lol",           // ISE — CDN 1080p
  "anitubeiphonebb.dalayqnwpo.lol",         // ISE — CDN SD
  "api.animestvs.org",                      // SAN — API
  "cdn.animestvs.org",                      // SAN — CDN de video
  "t.me",
  "m8q2v7r4k1-cloudflare-net.vercel.app",
  "autumn-thunder-094a.6qf1avv4zf6f.workers.dev",
  "lingering-cliff-b267.6qf1avv4zf6f.workers.dev",
  "silent-sun-6c57.a1n2jxh9r3li.workers.dev",
  // Origem de live do kakito: a playlist em kakito.xyz responde 302 para este IP nu, e e
  // ele que serve os segmentos (nginx, sem CDN). MEDIDO: o worker NAO consegue baixar
  // segmento deste host — a origem responde "Upstream 403" para o IP de borda da
  // Cloudflare. A entrada fica porque o guarda "host not allowed" happens antes, e se o
  // painel um dia liberar o IP de borda o caminho acende sozinho.
  "206.109.57.195",
];

const ALLOWED_SUFFIXES = [
  // PORTA NOVA DO ETC (decisao 148). MEDIDO 01/10/2026: as 3 portas antigas do ETC estao fora (a 1a
  // e a 3a em timeout de 15s, a 2a em 523), e o fornecedor tem um site novo que nao usa aquela
  // infraestrutura: o canal abre em `embedcanaisdetv.xyz` e o `.m3u8` sai deste CDN. Do IP de
  // datacenter do servidor a origem responde **403 "Attention Required!"** — e o subdominio do
  // player e longo e aleatorio (`ywppjexvly...cdn10embed.xyz`), por isso e SUFIXO e nao nome exato.
  ".cdn10embed.xyz",
  ".embedcanaisdetv.xyz",
  ".embedcanais.online",
  // REIDOSCANAIS (decisao 148): a playlist que o player dele revela tambem responde 403 ao IP de
  // datacenter. Mesmo caso do item acima.
  ".satlabscloud.com.br",
  ".rdcanais.net",
  ".googlevideo.com",
  ".cloudflarestorage.com",
  ".r2.dev",
  ".madfirebox.shop",
  ".maximaimg.online",
  ".123pelicula.com",
  ".hclod.qzz.io",
  ".watchplay.shop",
  ".s23-cloudfront-net.lat",
  ".blogspot.com",
  ".blogger.com",
  ".rdembed.sbs",
  // MEDIDO em 29/09/2026: o RON (animesdigital) passou a servir o video em
  // `cdn-s01.mywallpaper-4k-image.net/stream/.../*.mp4/index.m3u8`. O host NAO estava aqui, e
  // o relay `/relay/m/` respondia `host not allowed` — o canal aparecia, a lista abria, e o
  // video nao. Medido: a MESMA URL da `stream/proxy-check` do servidor devolve 200
  // `application/vnd.apple.mpegurl`. Entao a origem esta viva e o que faltava era a permissao.
  ".mywallpaper-4k-image.net",
];

const BLOCKED_HOST_PATTERNS = [/^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^\[?::1\]?$/, /^fc00:/i, /^fe80:/i, /^0\./, /^\[?::ffff:127\./i, /^\[?::ffff:10\./i, /^\[?::ffff:192\.168\./i, /\.local$/i, /\.internal$/i];

function hostAllowed(rawHost) {
  let host = String(rawHost || "").trim().toLowerCase();
  if (!host) return false;
  if (host.startsWith("[") && host.includes("]")) host = host.slice(1, host.indexOf("]"));
  if (host.includes(":")) host = host.split(":")[0];
  if (BLOCKED_HOST_PATTERNS.some(re => re.test(host))) return false;
  if (ALLOWED_HOSTS.includes(host)) return true;
  return ALLOWED_SUFFIXES.some(suffix => host === suffix.slice(1) || host.endsWith(suffix));
}

function targetAllowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return hostAllowed(u.hostname);
  } catch (_) {
    return false;
  }
}

function safeStatus(status, fallback) {
  const n = Number(status);
  return Number.isInteger(n) && n >= 200 && n <= 599 ? n : fallback;
}

function redirectTarget(res, currentUrl) {
  const loc = res.headers.get("Location");
  if (!loc) return null;
  const st = Number(res.status);
  if (st === 0 || (st >= 300 && st < 400)) {
    try { return new URL(loc, currentUrl).href; } catch (_) { return null; }
  }
  return null;
}

const resolvedStreams = new Map();
const RESOLVE_CACHE_TTL = 60000;
const MAX_RESOLVED_CACHE = 200;

async function httpGet(url, timeout = 8000, extraHeaders) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        ...extraHeaders,
      },
      redirect: "follow",
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveStreamUrl(channelId) {
  const now = Date.now();
  const cached = resolvedStreams.get(channelId);
  if (cached && now - cached.ts < RESOLVE_CACHE_TTL) return cached.sources;

  let lastError = null;
  for (const domain of EMBED_DOMAINS) {
    try {
      const outerRes = await httpGet(`https://${domain}/${channelId}`, 8000, {
        "Referer": "https://reidosembeds.online/",
        "Origin": "https://reidosembeds.online",
      });
      if (!outerRes.ok) {
        if (outerRes.status >= 500) lastError = new Error(`rde http ${outerRes.status}`);
        continue;
      }
      const outerHtml = await outerRes.text();

      const playMatch = outerHtml.match(/src="(https?:\/\/[^"]*\/__play\/[^"]+)"/);
      if (!playMatch) continue;
      const playUrl = playMatch[1].replace(/&amp;/g, "&");

      const playRes = await httpGet(playUrl, 10000, {
        "Referer": `https://${domain}/`,
      });
      if (!playRes.ok) {
        if (playRes.status >= 500) lastError = new Error(`rde play http ${playRes.status}`);
        continue;
      }
      const playHtml = await playRes.text();

      const sourcesMatch = playHtml.match(/var\s+sources\s*=\s*(\[.+?\])\s*;/s);
      if (sourcesMatch) {
        try {
          const sources = JSON.parse(sourcesMatch[1]);
          const valid = sources.filter(s => s.src && s.src.includes("http"));
          if (valid.length > 0) {
            for (const s of valid) s._innerOrigin = new URL(playUrl).origin;
            resolvedStreams.set(channelId, { sources: valid, ts: Date.now() });
            if (resolvedStreams.size > MAX_RESOLVED_CACHE) resolvedStreams.delete(resolvedStreams.keys().next().value);
            return valid;
          }
        } catch (e) { /* JSON parse error */ }
      }

      const iframeMatch = playHtml.match(/src="(https?:\/\/[^"]+)"/);
      if (!iframeMatch) continue;
      const innerUrl = iframeMatch[1].replace(/&amp;/g, "&");
      const innerOrigin = new URL(innerUrl).origin;

      const innerRes = await httpGet(innerUrl, 10000, {
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
      });
      if (!innerRes.ok) {
        if (innerRes.status >= 500) lastError = new Error(`rde iframe http ${innerRes.status}`);
        continue;
      }
      const innerHtml = await innerRes.text();

      const innerSourcesMatch = innerHtml.match(/var\s+sources\s*=\s*(\[.+?\])\s*;/s);
      if (!innerSourcesMatch) continue;
      try {
        const innerSources = JSON.parse(innerSourcesMatch[1]);
        const valid = innerSources.filter(s => s.src && s.src.includes("http"));
        if (valid.length > 0) {
          for (const s of valid) s._innerOrigin = innerOrigin;
          resolvedStreams.set(channelId, { sources: valid, ts: Date.now() });
          if (resolvedStreams.size > MAX_RESOLVED_CACHE) resolvedStreams.delete(resolvedStreams.keys().next().value);
          return valid;
        }
      } catch (e) { /* JSON parse error */ }
    } catch (e) { lastError = e; }
  }
  if (lastError) throw lastError;
  return [];
}
function rewriteM3u8(body, workerOrigin, baseUrl) {
  const base = new URL(baseUrl);
  const lines = body.split("\n");
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    let absoluteUrl;
    if (trimmed.startsWith("http")) {
      absoluteUrl = trimmed;
    } else if (trimmed.startsWith("//")) {
      absoluteUrl = "https:" + trimmed;
    } else if (trimmed.startsWith("/")) {
      absoluteUrl = `${base.origin}${trimmed}`;
    } else {
      absoluteUrl = new URL(trimmed, base).href;
    }
    return `${workerOrigin}/rde/seg?url=${encodeURIComponent(absoluteUrl)}`;
  }).join("\n");
}

async function handleRdeM3u8(channelId, origin) {
  const sources = await resolveStreamUrl(channelId);
  if (sources.length === 0) {
    return new Response("channel not found", { status: 404 });
  }

  const src = sources[0].src;
  const fetchHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  let cdnRes;
  try {
    cdnRes = await fetch(src, { signal: controller.signal, headers: fetchHeaders, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }

  if (!cdnRes.ok) {
    return new Response(`upstream ${cdnRes.status}`, { status: safeStatus(cdnRes.status, 502) });
  }

  const m3u8Text = await cdnRes.text();
  const rewritten = rewriteM3u8(m3u8Text, origin, src);

  return new Response(rewritten, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "public, max-age=3",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// DECISAO 124 — sinal para o Smart Placement. A Cloudflare so reposiciona o worker quando
// ele chama o MESMO destino mais de uma vez por invocacao ("more than one subrequest to a
// back-end resource"). Chamando o RTD uma vez so, o worker fica no data center de quem
// chamou — e o RTD so responde do Brasil (medido 30/09/2026: da prod, 403; do Brasil, 200).
// Esta chamada e um arquivo pequeno, em PARALELO com a que interessa (nao custa latencia),
// e so acontece quando o alvo e uma origem RTD. Se o RTD voltar a responder de qualquer
// lugar, ela e inofensiva: some no primeiro fetch.
const AQUECIMENTO_RTD = "https://redetoonstv.win/favicon.ico";

function eHostRtd(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "redetoons.win" || host === "www.redetoons.win" || host === "redetoonstv.win" || host === "www.redetoonstv.win";
  } catch (e) {
    return false;
  }
}

function aqueceParaRtd(url) {
  if (!eHostRtd(url)) return;
  fetch(AQUECIMENTO_RTD, { redirect: "follow" }).catch(() => null);
}

async function handleRdeSeg(targetUrl, workerOrigin, refOverride) {
  aqueceParaRtd(targetUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    const refererOrigin = new URL(targetUrl).origin;
    res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        "Referer": refOverride || refererOrigin + "/",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    return new Response(`upstream ${res.status}`, { status: safeStatus(res.status, 502) });
  }

  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const isM3u8 = /\.m3u8(\?|$)/i.test(targetUrl) || contentType.includes("mpegurl");

  let body;
  if (isM3u8) {
    const text = await res.text();
    body = rewriteM3u8(text, workerOrigin, targetUrl);
  } else {
    body = res.body;
  }

  const headers = new Headers({
    "Content-Type": isM3u8 ? "application/vnd.apple.mpegurl" : contentType,
    "Cache-Control": isM3u8 ? "public, max-age=2" : "public, max-age=10",
    "Access-Control-Allow-Origin": "*",
  });

  return new Response(body, { status: 200, headers });
}

function rewriteProxy(body, workerOrigin, baseUrl) {
  const lines = body.split("\n");
  return lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    let absoluteUrl;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      absoluteUrl = trimmed;
    } else if (trimmed.startsWith("//")) {
      absoluteUrl = "https:" + trimmed;
    } else {
      try {
        absoluteUrl = new URL(trimmed, baseUrl).href;
      } catch (_) {
        return line;
      }
    }
    return `${workerOrigin}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
  }).join("\n");
}


// --- origem cifrada: o cliente so recebe o token, o worker decifra e busca ---
function b64urlToBytes(t) {
  const s2 = String(t).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s2 + "=".repeat((4 - (s2.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function decifraToken(token) {
  const segredo = (typeof env !== "undefined" && env.PROXY_SECRET) || "mirror-proxy-v1-9f4c1a7e";
  let bruto;
  try { bruto = b64urlToBytes(token); } catch (_) { return null; }
  if (!bruto || bruto.length < 29) return null;
  const iv = bruto.subarray(0, 12);
  const tag = bruto.subarray(12, 28);
  const dados = bruto.subarray(28);
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(segredo));
    const chave = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
    const cifrado = new Uint8Array(dados.length + tag.length);
    cifrado.set(dados, 0);
    cifrado.set(tag, dados.length);
    const txt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv), tagLength: 128 }, chave, cifrado);
    const obj = JSON.parse(new TextDecoder().decode(txt));
    if (!obj || !obj.u) return null;
    return { u: obj.u, r: obj.r === "\u0000null" ? null : String(obj.r || "") };
  } catch (_) {
    return null;
  }
}

async function serveOrigemCifrada(request, token) {
  const alvo = await decifraToken(token);
  if (!alvo) return new Response("token invalido", { status: 403, headers: { "content-type": "text/plain" } });
  let parsed;
  try { parsed = new URL(alvo.u); } catch (_) { return new Response("url invalida", { status: 400 }); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return new Response("protocolo bloqueado", { status: 400 });
  if (!targetAllowed(parsed.href)) return new Response("host fora da lista", { status: 403, headers: { "content-type": "text/plain" } });

  const range = request.headers.get("range");
  const edge = caches.default;
  // A chave NAO tem a Range: e a resposta INTEIRA do arquivo. E por isso que so se consulta
  // o cache em pedido sem Range (ver armadilha 1 no bloco acima).
  const chave = new Request(`${urlOrigin(request)}/p/${token}`, { method: "GET" });

  if (!range) {
    const guardado = await edge.match(chave);
    if (guardado) {
      const h = new Headers(guardado.headers);
      h.set("x-mirror-cache", "HIT");
      h.set("access-control-allow-origin", "*");
      return new Response(guardado.body, { status: 200, headers: h });
    }
  }

  const headers = new Headers();
  headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
  if (alvo.r) headers.set("referer", alvo.r);
  if (range) headers.set("range", range);
  let upstream;
  try {
    upstream = await fetch(parsed.href, { headers, redirect: "follow" });
  } catch (e) {
    return new Response("origem inacessivel", { status: 502, headers: { "content-type": "text/plain" } });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("origem " + upstream.status, { status: 502, headers: { "content-type": "text/plain" } });
  }
  const saida = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) saida.set(h, v);
  }
  saida.set("access-control-allow-origin", "*");

  // Resposta parcial NUNCA e guardada (armadilha 1), e resposta de erro tambem nao
  // (armadilha 3). O `max-age` reflete o TTL real do tipo, para a BORDA do Cloudflare
  // guardar junto com o `caches.default` do worker.
  const tipo = saida.get("content-type") || "";
  const inteira = !range && upstream.status === 200;
  if (inteira && /^(audio|video|image|application\/octet-stream|text\/vtt)/i.test(tipo)) {
    const ttl = ttlDoAlvo(parsed);
    saida.set("cache-control", `public, max-age=${ttl}`);
    const paraGuardar = new Response(upstream.body, { status: 200, headers: saida });
    try { await edge.put(chave, paraGuardar.clone()); } catch (_) {}
    const h = new Headers(saida);
    h.set("x-mirror-cache", "MISS");
    // A resposta que SAI para a pessoa NAO pode ficar no cache automatico da borda, e o motivo
    // e o defeito que o dono reportou: pedindo uma faixa, a borda devolvia o ARQUIVO INTEIRO que
    // tinha guardado. O player pede o segundo 20, recebe o filme do zero, perde a sincronia do
    // container (tela branca) e o audio sai na taxa errada (os barulhos). MEDIDO em 29/09/2026.
    //
    // O cache continua existindo, em dois lugares: o `edge.put` acima (que e o `caches.default`
    // do proprio worker, consultado no topo desta funcao para quem pede o arquivo inteiro) e o
    // cache do painel, que e a origem. Perde-se so a copia automatica da borda — que era a que
    // quebrava a faixa. E o ganho continua: quem pede o filme inteiro e servido do `caches.default`
    // sem tocar no painel.
    h.set("cache-control", "no-store");
    return new Response(paraGuardar.body, { status: 200, headers: h });
  }

  if (!range) saida.set("cache-control", `public, max-age=${TTL_ARQUIVO}`);

  // A FAIXA QUE A ORIGEM IGNORA (29/09/2026). MEDIDO: o dono relatou que o filme "toca, passa uns
  // minutos, tela branca e uns barulhos, e para" — e o mesmo acontece ao pular posicao e ao
  // COPIAR O LINK (o que tira o addon da lista de suspeitos). Medido no link entregue: pedindo
  // 1KB do MEIO de um filme de 1,3GB, a resposta era **HTTP 200 com o filme inteiro**
  // (`content-range: bytes 0-1329098851/1329098852`).
  //
  // A cadeia do painel e `kakito.xyz -> voltm.uk?token=...`, e o `voltm.uk` **ignora o Range**
  // (comportamento deles, ja documentado no projeto). Ate aqui o worker repassava a resposta
  // como veio: o player pedia um pedaco e recebia o filme inteiro do zero. Quem faz isso nao
  // consegue sincronizar o container — tela branca — e o audio sai na taxa errada: os barulhos.
  // E o player vai pedindo de novo, cada vez do zero, ate desistir e parar.
  //
  // AQUI CORTA-SE A FAIXA. O corpo continua chegando inteiro da origem (nao ha como evitar sem
  // Range na origem), mas o que vai para o cliente e SO o trecho pedido, com 206 e
  // `Content-Range` de verdade. O descarte e feito no fluxo, sem guardar em memoria.
  if (range && upstream.status === 200 && upstream.body) {
    const pedido = /bytes=(\d+)-(\d*)/i.exec(range);
    // O tamanho total vem do `content-length` OU do `content-range` que a ORIGEM devolveu. Medido
    // em 29/09/2026: o painel as vezes responde 200 SEM `content-length` e com o
    // `content-range: bytes 0-N/T` — e ai o total era lido como zero, o corte nao acontecia e a
    // pessoa recebia o filme inteiro, que e exatamente o defeito que estamos consertando.
    const total = Number(upstream.headers.get("content-length") || 0)
      || Number((/\/(\d+)\s*$/.exec(upstream.headers.get("content-range") || "") || [])[1] || 0);
    if (pedido && total > 0) {
      const inicio = Number(pedido[1]);
      const ultima = pedido[2] ? Number(pedido[2]) : total - 1;
      const fim = Math.min(ultima, total - 1);
      // FAIXA LONGE DO COMECO: para entregar 1KB a partir de 500MB, o worker teria de puxar
      // 500MB da origem so para descartar. Medido em 29/09/2026: dentro do limite dele nao da,
      // e o resultado era **206 com corpo vazio** — que e PIOR que devolver o arquivo inteiro,
      // porque o player recebe a promessa da faixa e nao recebe nada. Nesses casos devolve-se o
      // arquivo inteiro (200), que e o que o player sabe manusear. Quem consegue pular de verdade
      // e o que tem faixa de verdade; para estes arquivos a origem que nao sabe.
      const ALCANCE_SEM_DESCARTE = 32 * 1024 * 1024;
      if (fim >= inicio && inicio <= ALCANCE_SEM_DESCARTE) {
        const janela = new ReadableStream({
          async start(controller) {
            const leitor = upstream.body.getReader();
            let pos = 0;
            let entregue = 0;
            const quero = fim - inicio + 1;
            try {
              while (entregue < quero) {
                const pedaco = await leitor.read();
                if (pedaco.done) break;
                const comeco = pos;
                pos += pedaco.value.length;
                const de = Math.max(0, inicio - comeco);
                const ate = Math.min(pedaco.value.length, (fim - comeco) + 1);
                if (ate > de) {
                  controller.enqueue(pedaco.value.subarray(de, ate));
                  entregue += ate - de;
                }
              }
            } catch (_) { /* cliente fechou a conexao no meio */ }
            try { controller.close(); } catch (_) {}
            try { await leitor.cancel(); } catch (_) {}
          },
        });
        const h = new Headers(saida);
        h.set("content-length", String(fim - inicio + 1));
        h.set("content-range", `bytes ${inicio}-${fim}/${total}`);
        h.set("accept-ranges", "bytes");
        // Faixa cortada por nos nao entra no cache: e especifica do pedido.
        h.set("cache-control", "no-store");
        h.set("x-mirror-faixa", "cortada");
        return new Response(janela, { status: 206, headers: h });
      }
    }
  }

  saida.set("x-mirror-faixa", upstream.status === 206 ? "origem-fez" : (range ? "pass-through" : "sem-faixa"));
  return new Response(upstream.body, { status: upstream.status === 206 ? 206 : 200, headers: saida });
}


// Cache de segmento de TV no edge. O worker NAO alcanca a midia de live do kakito
// (a origem responde "Upstream 403" para o IP de borda, medido), entao no cache miss ele
// busca NO NOSSO SERVIDOR, que alcanca. O caminho do segmento tem hash de conteudo, entao
// a resposta e sempre a mesma: guardamos com TTL longo e o resto das pessoas vem da
// borda sem tocar em ninguem. Mesmo formato de token cifrado do /p/ — o cliente nunca ve
// a URL de origem.
// TTL do segmento no relay. Curto de proposito: o segmento e imutavel na sequencia, mas o
// canal pode trocar de sinal a qualquer momento e um cache longo seguraria video velho.
const TTL_SEGMENTO_RELAY = Number((typeof env !== "undefined" && env.CACHE_TTL_RELAY_SEG) || 60);
const CACHE_TTL_SEG = 14400;
const CACHE_TTL_JANELA = 180; // janela de rolagem no R2 (3 min) — TV ao vivo nao guarda historico
const HASH_RE = /\/[0-9a-f]{32}\/[^/]+\.(ts|m4s|mp4)$/i;

// ============ CACHE DO VIDEO DE VOD (rota /p/) ============
// A ideia e a que o dono pediu: o primeiro que pede vai a origem, os outros vem da borda.
//
// O worker ja tinha a PECA — `caches.default` funcionando no `/cdn/` e a allowlist
// (`targetAllowed`) com todos os hosts das 12 fontes de VOD + as 3 de TV. O que faltava era
// ligar as duas coisas na rota `/p/`, que e por onde o VOD sai cifrado. Antes dela respondia
// `max-age=60`: praticamente sem cache, entao 20 pessoas assistindo o mesmo filme iam 20 veze
// a origem.
//
// TRES ARMADILHAS que decidiram o desenho, todas medidas:
//
// (1) RANGE NAO PODE ENTRAR NO CACHE. O `caches.default` guarda a resposta INTEIRA e nao sabe
//     fatiar. Se um cliente pede `Range: bytes=0-` e o worker guarda essa fatia como se fosse
//     o arquivo, o proximo que pedir `bytes=900000-` recebe o inicio do video de novo. O
//     sintoma e video pulando no meio — bem pior que sem cache. Entao: pedido com `Range`
//     NAO entra no cache e nao sai dele; e o cache so e consultado em pedido sem Range.
//     Isso nao perde nada: player pede segmento inteiro sem Range, e so o seek manda Range.
//
// (2) TTL POR TIPO, NAO UM SO. A rota `/p/` carrega tres coisas muito diferentes:
//     - `.ts`/`.m4s` = pedaco de HLS. O nome tem hash de conteudo, entao o byte e sempre o
//       mesmo: TTL longo (4h), e e o que mais se repete.
//     - `.m3u8` = playlist. De VOD ela e estatica; de TV ao vivo muda a cada 10s. TTL curto
//       (60s) cobre os dois casos sem servir playlist velha de live.
//     - `.mp4` = arquivo. So que a ORIGEM pode ter URL assinada com prazo: o VZR vale 5h e
//       o RTD cerca de 3 dias. TTL de 24h seria seguro so ate a assinatura expirar; como o
//       worker nao sabe a validade, MP4 fica em 2h — bem abaixo do prazo mais curto que
//       conhecemos, e ainda assim corta a repeticao de quem assiste o mesmo titulo.
//
// (3) SO CACHEIA RESPOSTA BOA. 4xx/5xx da origem nao entra: guardar um 403 transforma um
//     tropeco momentaneo em video quebrado para todo mundo ate o TTL expirar.
const TTL_SEGMENTO = Number((typeof env !== "undefined" && env.CACHE_TTL_SEGMENTO) || 4 * 3600);
const TTL_PLAYLIST = Number((typeof env !== "undefined" && env.CACHE_TTL_PLAYLIST) || 60);
const TTL_ARQUIVO = Number((typeof env !== "undefined" && env.CACHE_TTL_ARQUIVO) || 2 * 3600);

function ttlDoAlvo(parsed) {
  const caminho = parsed.pathname.toLowerCase();
  if (/\.(ts|m4s|cmfv|cmfa|aac|vtt|webp)$/.test(caminho)) return TTL_SEGMENTO;
  if (/\.m3u8?$/.test(caminho)) return TTL_PLAYLIST;
  if (HASH_RE.test(caminho)) return TTL_SEGMENTO;
  return TTL_ARQUIVO;
}

function addonBase() {
  const v = (typeof env !== "undefined" && env.ADDON_BASE) || "https://c12e41ddc21b-mirror2.baby-beamup.club";
  return String(v).replace(/\/+$/, "");
}

function urlOrigin(request) {
  try { return new URL(request.url).origin; } catch (_) { return "https://cache.local"; }
}

async function handleCdnSegment(request, file) {
  const token = String(file || "").replace(/\.(ts|m4s|mp4)$/i, "");
  const alvo = await decifraToken(token);
  if (!alvo) return new Response("token invalido", { status: 403, headers: { "content-type": "text/plain" } });
  let parsed;
  try { parsed = new URL(alvo.u); } catch (_) { return new Response("url invalida", { status: 400 }); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return new Response("protocolo bloqueado", { status: 400 });
  if (!/^206\.109\.57\.195$/.test(parsed.hostname) || !/^\/hlsr\//.test(parsed.pathname) || !HASH_RE.test(parsed.pathname)) {
    return new Response("alvo fora do cache", { status: 403, headers: { "content-type": "text/plain" } });
  }

  const cache = caches.default;
  const chave = new Request(`${urlOrigin(request)}/cdn/${token}.ts`, { method: "GET" });
  const guardado = await cache.match(chave);
  if (guardado) {
    const h = new Headers(guardado.headers);
    h.set("x-mirror-cache", "HIT");
    h.set("access-control-allow-origin", "*");
    return new Response(guardado.body, { status: 200, headers: h });
  }

  // Janela de rolagem no R2. TV ao vivo nao e arquivo: cada segmento morre em ~10s, entao
  // guardar o passado e jogar espaco fora. Guardamos so uma janela curta — o suficiente
  // para a borda servir sem ir a origem e para um teste que abre N canais nao virar avalha.
  // A chave e o token (que ja esconde a origem do cliente).
  const r2 = (typeof env !== "undefined" && env.SEG) ? env.SEG : null;
  if (r2) {
    try {
      const noR2 = await r2.get(token);
      if (noR2) {
        const corpo = await noR2.arrayBuffer();
        const resp = new Response(corpo, {
          status: 200,
          headers: {
            "content-type": noR2.httpMetadata && noR2.httpMetadata.contentType || "video/mp2t",
            "cache-control": `public, max-age=${CACHE_TTL_SEG}, immutable`,
            "access-control-allow-origin": "*",
            "x-mirror-cache": "R2",
          },
        });
        try { await cache.put(chave, resp.clone()); } catch (_) {}
        return resp;
      }
    } catch (_) {}
  }

  const base = addonBase();
  const via = `${base}/stream/proxy?url=${encodeURIComponent(parsed.href)}`;
  let upstream;
  // Cache miss e a origem lenta: com varios canais frios ao mesmo tempo, 25s estourava e
  // o canal morria. Damos 70s e tentamos de novo uma vez.
  for (const tentativa of [1, 2]) {
    try {
      upstream = await fetch(via, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow", signal: AbortSignal.timeout(70000) });
    } catch (e) {
      upstream = null;
    }
    if (upstream && upstream.ok) break;
    if (tentativa === 1) await new Promise((r) => setTimeout(r, 1200));
  }
  if (!upstream || !upstream.ok) {
    return new Response("origem " + (upstream ? upstream.status : "sem resposta"), { status: 502, headers: { "content-type": "text/plain" } });
  }

  const corpo = await upstream.arrayBuffer();
  // grava na janela de rolagem: 3 minutos. TV ao vivo nao guarda historico — cada segmento
  // e substituido em ~10s, entao a janela e curta de proposito (e o que cabe nos 10GB).
  const janela = Number(CACHE_TTL_JANELA || 180);
  if (r2) {
    try {
      await r2.put(token, corpo, {
        expiration: Math.floor(Date.now() / 1000) + janela,
        httpMetadata: { contentType: upstream.headers.get("content-type") || "video/mp2t" },
      });
    } catch (_) {}
  }
  const resposta = new Response(corpo, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") || "video/mp2t",
      "cache-control": `public, max-age=${CACHE_TTL_SEG}, immutable`,
      "access-control-allow-origin": "*",
      "x-mirror-cache": "MISS",
    },
  });
  try { await cache.put(chave, resposta.clone()); } catch (_) {}
  return resposta;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type",
        },
      });
    }

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // Diagnostico da decisao 123: por que este worker responde o RTD (ou nao). Devolve 302
    // com o colo onde a requisicao foi processada no caminho, porque o /stream/proxy-check
    // da prod so devolve o corpo quando a resposta NAO e 2xx — o redirect deixa o colo
    // visivel no campo finalUrl. GRU = Sao Paulo (BR); FRA/LHR/etc = fora do Brasil.
    if (url.pathname === "/colo") {
      const colo = (request.cf && request.cf.colo) || "sem-colo";
      const onde = request.headers.get("cf-placement") || "sem-placement";
      return new Response(null, { status: 302, headers: { Location: `${url.origin}/onde/${colo}/${onde}` } });
    }

    if (url.pathname === "/rde/m3u8") {
      const channelId = url.searchParams.get("id");
      if (!channelId) return new Response("Missing ?id= parameter", { status: 400 });
      try {
        return await handleRdeM3u8(channelId, url.origin);
      } catch (e) {
        return new Response("rde error: " + e.message, { status: 502 });
      }
    }

    if (url.pathname === "/rde/seg") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing ?url= parameter", { status: 400 });
      if (!targetAllowed(decodeURIComponent(targetUrl))) return new Response("host not allowed", { status: 403 });
      try {
        return await handleRdeSeg(decodeURIComponent(targetUrl), url.origin, url.searchParams.get("ref"));
      } catch (e) {
        return new Response("seg error: " + e.message, { status: 502 });
      }
    }

    if (url.pathname.startsWith("/relay/m/")) {
      const encoded = url.pathname.replace("/relay/m/", "").replace(/\.m3u8$/, "");
      try {
        let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
        b64 += "=".repeat((4 - (b64.length % 4)) % 4);
        const originUrl = atob(b64);
      if (!targetAllowed(originUrl)) return new Response("host not allowed", { status: 403 });
        const relayRef = url.searchParams.get("ref") || "";
        const chavePlaylist = new Request(`${url.origin}${url.pathname}?${url.searchParams.toString()}`, { method: "GET" });
        try {
          const guardada = await caches.default.match(chavePlaylist);
          if (guardada) {
            const h = new Headers(guardada.headers);
            h.set("x-mirror-cache", "HIT");
            return new Response(guardada.body, { status: 200, headers: h });
          }
        } catch (_) {}
        const headersPlaylist = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        };
        if (relayRef) headersPlaylist.Referer = relayRef;
        const resp = await fetch(originUrl, {
          headers: headersPlaylist,
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) return new Response("Upstream " + resp.status, { status: safeStatus(resp.status, 502) });
        const m3u8 = await resp.text();
        const base = new URL(originUrl);
        const lines = m3u8.split("\n");
        const segmentUrl = (ref, referer) => `${url.origin}/relay/s/${btoa(ref).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.ts${referer ? `?ref=${encodeURIComponent(referer)}` : ""}`;
        const absolute = ref => {
          if (ref.startsWith("http")) return ref;
          if (ref.startsWith("/")) return base.origin + ref;
          return new URL(ref, originUrl).href;
        };
        const rewritten = lines.map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith("#")) {
            if (!/URI="/.test(trimmed)) return line;
            return line.replace(/URI="([^"]+)"/g, (_m, ref) => `URI="${segmentUrl(absolute(ref), relayRef)}"`);
          }
          return segmentUrl(absolute(trimmed), url.searchParams.get("ref"));
        }).join("\n");
        const resposta = new Response(rewritten, {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": `public, max-age=${TTL_PLAYLIST}`,
            "x-mirror-cache": "MISS",
            "x-relay-shared-manifest": "1",
          },
        });
        try { await caches.default.put(chavePlaylist, resposta.clone(), { expiration: { ttlSeconds: TTL_PLAYLIST } }); } catch (_) {}
        return resposta;
      } catch (e) {
        return new Response("relay error: " + e.message, { status: 502 });
      }
    }

    // MEDIDO em 29/09/2026: o `/relay/s/` e o `/relay/m/` mandavam um User-Agent TRUNCADO
    // ("...AppleWebKit/537.36", sem a parte do Chrome/Safari). O AON e o SHG entregam video em
    // `redirector.googlevideo.com`, e esse host so responde com o UA COMPLETO: medido, o mesmo
    // link deu 403 com o UA truncado e 276 frames com o completo. A variante "sem cabecalho"
    // que o servidor cria para essas fontes saia, portanto, com 403 — link morto na lista, que
    // e pior do que nao ter variante. Todos os pontos do worker agora usam o mesmo UA inteiro.
    if (url.pathname.startsWith("/relay/s/")) {
      const encoded = url.pathname.replace("/relay/s/", "").replace(/\.ts$/, "");
      try {
        let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
        b64 += "=".repeat((4 - (b64.length % 4)) % 4);
        const originUrl = atob(b64);
      if (!targetAllowed(originUrl)) return new Response("host not allowed", { status: 403 });
        const rangeHeader = request.headers.get("Range");

        // CACHE DE SEGMENTO NA BORDA (decisao 127). MEDIDO 30/09/2026: o `/relay/s/` NAO usava
        // `caches.default` — cada espectador ia na origem. Com N pessoas no mesmo canal, o
        // mesmo segmento era buscado N vezes.
        //
        // A CHAVE e a URL do proprio worker (o caminho tem o base64 da origem e o `?ref=`), e
        // nao a URL de origem: assim o `Referer` diferente (que muda o que o CDN devolve) nunca
        // divide cache, e as pessoas do mesmo canal dividem. A resposta da origem vem com
        // sequencia (TS ao vivo), que nao muda — o TTL curto e por margem, e a PLAYLIST e que
        // precisa ser fresquinha (ela vai em `no-store`, e sempre foi).
        //
        // RANGE NAO ENTRA NO CACHE: `caches.default` guarda a resposta inteira e nao sabe
        // montar faixa — guardar um 206 devolveria os bytes errados para quem pediu a faixa
        // (a mesma razao que ja vale no `/p/`).
        const chaveSegmento = rangeHeader ? null : new Request(`${url.origin}${url.pathname}${url.search}`);
        if (chaveSegmento) {
          try {
            const guardado = await caches.default.match(chaveSegmento);
            if (guardado) {
              const h = new Headers(guardado.headers);
              h.set("x-mirror-cache", "HIT");
              return new Response(guardado.body, { status: 200, headers: h });
            }
          } catch (_) { /* sem cache: segue para a origem */ }
        }
        const fetchHeaders = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        };
        if (rangeHeader) fetchHeaders["Range"] = rangeHeader;
        const refParam = url.searchParams.get("ref");
        if (refParam) fetchHeaders["Referer"] = refParam;

        let currentUrl = originUrl;
        let originResp;
        for (let i = 0; i < 5; i++) {
          originResp = await fetch(currentUrl, { headers: fetchHeaders, redirect: "manual" });
          const next = redirectTarget(originResp, currentUrl);
          if (next) { currentUrl = next; continue; }
          break;
        }

        if (!originResp.ok) return new Response("Upstream " + originResp.status, { status: safeStatus(originResp.status, 502) });

        const respHeaders = new Headers({ "Access-Control-Allow-Origin": "*" });
        for (const [key, value] of originResp.headers) {
          if (!["content-security-policy", "set-cookie"].includes(key.toLowerCase())) {
            respHeaders.set(key, value);
          }
        }
        respHeaders.set("Content-Type", "video/mp2t");
        respHeaders.set("Accept-Ranges", "bytes");
        if (chaveSegmento) respHeaders.set("x-mirror-cache", "MISS");
        const resposta = new Response(originResp.body, { status: safeStatus(originResp.status, 200), headers: respHeaders });
        if (chaveSegmento) {
          // TTL curto (o segmento e ao vivo, mas imutavel na sequencia) e so para GET inteiro.
          const paraGuardar = resposta.clone();
          try {
            await caches.default.put(chaveSegmento, paraGuardar, { expiration: { ttlSeconds: TTL_SEGMENTO_RELAY } });
          } catch (_) {}
        }
        return resposta;
      } catch (e) {
        return new Response("relay seg error: " + e.message, { status: 502 });
      }
    }

    const cifrada = url.pathname.match(/^\/p\/([A-Za-z0-9_-]+)\.(?:mp4|m3u8|ts)$/);
    if (cifrada) return serveOrigemCifrada(request, cifrada[1]);

    if (url.pathname.startsWith("/cdn/")) {
      try {
        return await handleCdnSegment(request, url.pathname.slice(5));
      } catch (e) {
        return new Response("cache error", { status: 500, headers: { "content-type": "text/plain" } });
      }
    }

    if (url.pathname === "/pl") {
      const id = url.searchParams.get("id") || "";
      const tk = url.searchParams.get("t") || "";
      if (!/^\d{1,8}$/.test(id) || !tk) return new Response("bad params", { status: 400 });
      const target = `http://206.109.57.195:80/live/USUARIO_DO_PAINEL/SENHA_DO_PAINEL/${id}.m3u8?token=${encodeURIComponent(tk)}`;
      try {
        const r = await fetch(target, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" },
          signal: AbortSignal.timeout(25000),
        });
        const body = await r.text();
        const urls = body.split("\n").filter((x) => x.trim() && !x.startsWith("#")).length;
        return new Response(body, {
          status: r.status,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
            "X-Kak-Urls": String(urls),
            "X-Kak-Len": String(body.length),
          },
        });
      } catch (e) {
        return new Response("worker err: " + e.message, { status: 502 });
      }
    }

    // Cache compartilhado de resolução. O plugin consulta primeiro; em um miss, resolve
    // localmente e faz warm-up deste endpoint. O valor é somente uma lista de streams
    // validada contra a allowlist, sem credenciais ou páginas de origem.
    if (url.pathname === "/resolve") {
      const chave = url.searchParams.get("k") || "";
      if (!/^[a-z0-9_-]{3,80}$/i.test(chave)) return new Response("bad resolution key", { status: 400 });
      const chaveCache = new Request(`${url.origin}/resolve?k=${encodeURIComponent(chave)}`);
      const dadosParam = url.searchParams.get("data");
      if (dadosParam) {
        let dados;
        try { dados = JSON.parse(dadosParam); } catch (_) { try { dados = JSON.parse(decodeURIComponent(dadosParam)); } catch (__) { dados = null; } }
        if (!Array.isArray(dados) || dados.length > 25) return new Response("bad resolution data", { status: 400 });
        const streams = dados.filter((s) => s && typeof s.url === "string" && targetAllowed(s.url)).map((s) => ({
          url: s.url,
          ...(s.quality ? { quality: String(s.quality).slice(0, 20) } : {}),
          ...(s.title ? { title: String(s.title).slice(0, 160) } : {}),
          ...(s.name ? { name: String(s.name).slice(0, 160) } : {}),
          ...(s.language ? { language: String(s.language).slice(0, 40) } : {}),
          ...(s.idioma ? { idioma: String(s.idioma).slice(0, 40) } : {}),
          ...(s.headers && typeof s.headers === "object" ? { headers: Object.fromEntries(Object.entries(s.headers).filter(([k, v]) => /^(referer|user-agent|origin|accept)$/i.test(k) && typeof v === "string").map(([k, v]) => [k, v.slice(0, 300)])) } : {})
        }));
        if (!streams.length) return new Response("no allowed streams", { status: 400 });
        const resposta = new Response(JSON.stringify({ streams, storedAt: Date.now() }), { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800", "X-Mirror-Resolution": "MISS-WARM" } });
        try { await caches.default.put(chaveCache, resposta.clone()); } catch (_) {}
        return resposta;
      }
      try {
        const cached = await caches.default.match(chaveCache);
        if (cached) { const headers = new Headers(cached.headers); headers.set("X-Mirror-Resolution", "HIT"); return new Response(cached.body, { status: 200, headers }); }
      } catch (_) {}
      return new Response(JSON.stringify({ streams: [] }), { status: 404, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Mirror-Resolution": "MISS" } });
    }

    // Relay de mídia consumido pelo plugin. Metadados continuam em `/proxy`; esta rota
    // possui cache explícito apenas para playlists/segmentos e nunca guarda 206.
    // Se a origem recusar o IP da Cloudflare, devolvemos redirect para o aparelho tentar
    // diretamente — ativar a borda não pode transformar um player válido em player morto.
    if (url.pathname === "/proxy" && url.searchParams.get("media") === "1") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing ?url= parameter", { status: 400 });
      let decoded;
      try { decoded = decodeURIComponent(targetUrl); } catch (_) { return new Response("bad url encoding", { status: 400 }); }
      if (!targetAllowed(decoded)) return new Response("host not allowed", { status: 403 });
      const ref = url.searchParams.get("ref") || "";
      const rangeHeader = request.headers.get("Range");
      const isM3u8 = /\.m3u8(?:\?|$)/i.test(decoded);
      const isSegment = /\.(?:ts|m4s|aac)(?:\?|$)/i.test(decoded);
      const cacheable = !rangeHeader && (isM3u8 || isSegment);
      const cacheKey = cacheable ? new Request(`${url.origin}/proxy?media=1&url=${encodeURIComponent(decoded)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`) : null;
      if (cacheKey) {
        const cached = await caches.default.match(cacheKey);
        if (cached) {
          const h = new Headers(cached.headers); h.set("x-mirror-cache", "HIT");
          return new Response(cached.body, { status: cached.status, headers: h });
        }
      }
      try {
        const fetchHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36" };
        if (ref) fetchHeaders.Referer = ref;
        if (rangeHeader) fetchHeaders.Range = rangeHeader;
        let currentUrl = decoded;
        let originResp;
        for (let i = 0; i < 5; i++) {
          originResp = await fetch(currentUrl, { headers: fetchHeaders, redirect: "manual", signal: AbortSignal.timeout(30000) });
          const next = redirectTarget(originResp, currentUrl);
          if (next) { currentUrl = next; continue; }
          break;
        }
        if (!originResp || !originResp.ok) {
          const status = originResp ? originResp.status : 502;
          if (status === 401 || status === 403 || status === 408 || status === 429 || status >= 500) {
            return new Response(null, { status: 307, headers: { Location: decoded, "Cache-Control": "no-store", "X-Mirror-Edge": "fallback-direct" } });
          }
          return new Response(`Upstream ${status}`, { status: safeStatus(status, 502) });
        }
        let body = originResp.body;
        let contentType = originResp.headers.get("content-type") || (isM3u8 ? "application/vnd.apple.mpegurl" : "video/mp4");
        const responseHeaders = new Headers({ "Access-Control-Allow-Origin": "*", "Content-Type": contentType });
        for (const [key, value] of originResp.headers) {
          if (!["content-security-policy", "set-cookie", "content-length"].includes(key.toLowerCase())) responseHeaders.set(key, value);
        }
        let cacheTtl = isSegment ? 60 : 2;
        if (isM3u8) {
          const text = await originResp.text();
          body = rewriteProxy(text, url.origin, decoded).split(`${url.origin}/proxy?`).join(`${url.origin}/proxy?media=1&`);
          if (ref) body = body.split(`${url.origin}/proxy?media=1&url=`).join(`${url.origin}/proxy?media=1&ref=${encodeURIComponent(ref)}&url=`);
          contentType = "application/vnd.apple.mpegurl";
          responseHeaders.set("Content-Type", contentType);
          cacheTtl = /#EXT-X-ENDLIST/i.test(text) ? 3600 : 2;
        }
        responseHeaders.set("Cache-Control", cacheKey ? `public, max-age=${cacheTtl}` : (rangeHeader ? "no-store" : "public, max-age=10"));
        if (cacheKey) responseHeaders.set("x-mirror-cache", "MISS");
        const response = new Response(body, { status: originResp.status === 206 ? 206 : 200, headers: responseHeaders });
        if (cacheKey) { try { await caches.default.put(cacheKey, response.clone()); } catch (_) {} }
        return response;
      } catch (_) {
        return new Response(null, { status: 307, headers: { Location: decoded, "Cache-Control": "no-store", "X-Mirror-Edge": "fallback-direct" } });
      }
    }

    if (url.pathname === "/proxy") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing ?url= parameter", { status: 400 });

      let decoded;
      try {
        decoded = decodeURIComponent(targetUrl);
      } catch (e) {
        return new Response("bad url encoding", { status: 400 });
      }
      if (!targetAllowed(decoded)) return new Response("host not allowed", { status: 403 });
      const isM3u8 = /\.m3u8(\?|$)/i.test(decoded);
      aqueceParaRtd(decoded);

      try {
        const fetchHeaders = {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
        };
        const ref = url.searchParams.get("ref");
        if (ref) fetchHeaders["Referer"] = ref;
        const rangeHeader = request.headers.get("Range");
        if (rangeHeader) fetchHeaders["Range"] = rangeHeader;

        let currentUrl = decoded;
        let originResp;
        for (let i = 0; i < 5; i++) {
          originResp = await fetch(currentUrl, {
            headers: fetchHeaders,
            redirect: "manual",
            signal: AbortSignal.timeout(30000),
          });
          const next = redirectTarget(originResp, currentUrl);
          if (next) { currentUrl = next; continue; }
          break;
        }

        if (!originResp.ok) {
          return new Response(`Upstream ${originResp.status}`, { status: safeStatus(originResp.status, 502) });
        }

        let respBody;
        let contentType = originResp.headers.get("content-type") || "";

        if (isM3u8) {
          const text = await originResp.text();
          respBody = rewriteProxy(text, url.origin, decoded);
          contentType = "application/vnd.apple.mpegurl";
        } else {
          respBody = originResp.body;
        }

        const respHeaders = new Headers({ "Access-Control-Allow-Origin": "*" });
        for (const [key, value] of originResp.headers) {
          if (!["content-security-policy", "set-cookie"].includes(key.toLowerCase())) {
            respHeaders.set(key, value);
          }
        }
        respHeaders.set("Content-Type", contentType);
        respHeaders.set("Accept-Ranges", "bytes");
        respHeaders.set("Cache-Control", isM3u8 ? "public, max-age=2" : "public, max-age=10");

        return new Response(respBody, { status: safeStatus(originResp.status, 200), headers: respHeaders });
      } catch (e) {
        return new Response("upstream error: " + e.message, { status: 502 });
      }
    }

    return new Response("Mirror CDN Worker\n\nEndpoints:\n  /health\n  /resolve?k=SOURCE-KEY[&data=JSON] - cache compartilhado de resolução\n  /proxy?media=1&url=ENCODED_URL[&ref=REFERER] - relay/cache de mídia com fallback direto\n  /relay/m/{base64}.m3u8 - HLS relay manifest\n  /relay/s/{base64}.ts[?ref=REFERER] - relay de midia (injeta o Referer)\n  /rde/m3u8?id=CHANNEL_ID\n  /rde/seg?url=ENCODED_URL[&ref=REFERER]\n  /proxy?url=ENCODED_URL[&ref=REFERER]", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
