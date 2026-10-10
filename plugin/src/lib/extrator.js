const H = require("./html");
const { pegar } = require("./http");
const { detectHost, ehMidia, resolveUrl } = require("./url-resolver");
const { normalizeQuality, extractQuality } = require("./quality");
const cache = cacheCurto(150, 10 * 60 * 1e3);
function cacheCurto(tamanho, ttl) {
  const dados = new Map();
  function get(chave) {
    const hit = dados.get(chave);
    if (hit && hit.expira > Date.now()) {
      dados.delete(chave);
      dados.set(chave, hit);
      return hit.valor;
    }
    if (hit) dados.delete(chave);
    return null;
  }
  function set(chave, valor, ttlProprio) {
    dados.delete(chave);
    dados.set(chave, { valor, expira: Date.now() + (Number.isFinite(ttlProprio) ? ttlProprio : ttl) });
    while (dados.size > tamanho) dados.delete(dados.keys().next().value);
  }
  return { get, set };
}
function origemDe(url) {
  try {
    return new URL(url).origin + "/";
  } catch (_) {
    return "";
  }
}
function literal(texto, marcador, limite = 4e4) {
  const fonte = String(texto || "");
  if (!fonte) return null;
  let comecou = -1;
  if (marcador) {
    const achado = fonte.indexOf(marcador);
    if (achado < 0) return null;
    comecou = achado + marcador.length;
  } else {
    comecou = 0;
  }
  const abre = fonte.slice(comecou, comecou + limite).search(/[[{]/);
  if (abre < 0) return null;
  return literalEm(fonte, comecou + abre, limite);
}
function literalEm(fonte, inicio, limite = 4e4) {
  const pares = { "[": "]", "{": "}" };
  const pilha = [pares[fonte[inicio]]];
  if (!pilha[0]) return null;
  let dentroDeTexto = false, escape = false;
  for (let i = inicio + 1; i < fonte.length && i < inicio + limite; i++) {
    const c = fonte[i];
    if (dentroDeTexto) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"' || c === "'" || c === "`") dentroDeTexto = false;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      dentroDeTexto = true;
      continue;
    }
    if (c === "/" && fonte[i + 1] === "/") {
      const fim = fonte.indexOf("\n", i);
      if (fim < 0) return null;
      i = fim;
      continue;
    }
    if (c === "/" && fonte[i + 1] === "*") {
      const fim = fonte.indexOf("*/", i);
      if (fim < 0) return null;
      i = fim + 1;
      continue;
    }
    if (c === "{" || c === "[") {
      pilha.push(pares[c]);
      continue;
    }
    if (c === "}" || c === "]") {
      if (c !== pilha[pilha.length - 1]) {
        return null;
      }
      pilha.pop();
      if (!pilha.length) return tryParse(fonte.slice(inicio, i + 1));
    }
  }
  return null;
}
function semComentario(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n"']*/g, "$1 ");
}
function tryParse(pedaco) {
  const bruto = String(pedaco);
  const tentativas = [bruto, semComentario(bruto)];
  for (const texto of tentativas) {
    try {
      const r = JSON.parse(texto);
      if (r && typeof r === "object") return r;
    } catch (_) {
    }
  }
  try {
    const r = JSON.parse(semComentario(bruto).replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/'([^'\\]*)'/g, '"$1"'));
    if (r && typeof r === "object") return r;
  } catch (_) {
  }
  return null;
}
function flexivel(pedaco) {
  return tryParse(pedaco);
}
const EXT_MIDIA = /\.(m3u8|mp4|mkv|webm|mov|flv|ts)(\?|#|$)/i;
const CHAVE_MIDIA = /^(file|src|source|sources|url|uri|video|videourl|filelink|link|stream|playlist|hls|dash|download|content|embed|src_?hd|file_?hd|file_?fhd|master)/i;
const CHAVE_FORTE = /^(src|file|file_?hd|file_?fhd|file_?sd|src_?hd|src_?sd|hls|hlsurl|hls_?url|master|masterurl|playlist|stream|streamurl|stream_?url|video|videourl|media|mediaurl|src_?url)$/i;
const IGNORADOS = [
  /\.jpe?g|\.png|\.gif|\.webp|\.svg|\.ico|\.css|\.woff2?|\.ttf|\.eot([?#]|$)/i,
  /doubleclick|googlesyndication|google-analytics|googletagmanager|adservice|adnxs|doubleclick\.net/i,
  /\/(logo|poster|thumb|thumbnail|banner|avatar|img|image|images|perfil|capa|cover|preview|amostra|sample)[/_-]/i,
  /[?&](utm_|fbclid|gclid|msclkid)/i,
  /\b(trailer|teaser|prevista|amostra|preview)\b/i
];
function pontuar(url, dica, deConfig) {
  const u = String(url || "");
  const forte = deConfig && dica && CHAVE_FORTE.test(dica);
  let p = 0;
  if (/\.m3u8(\?|#|$)/i.test(u)) p += 40;
  else if (/\.mp4(\?|#|$)/i.test(u)) p += 45;
  else if (/\.(mkv|webm|mov|flv|ts)(\?|#|$)/i.test(u)) p += 20;
  else if (forte) p = 30;
  else return -1;
  const qualidade = extractQuality(u) || normalizeQuality(dica || "") || "";
  if (/2160|4k/i.test(qualidade)) p += 30;
  else if (/1080|fullhd/i.test(qualidade)) p += 24;
  else if (/720|hd/i.test(qualidade)) p += 16;
  else if (/480|sd/i.test(qualidade)) p += 8;
  else if (/360/i.test(qualidade)) p += 3;
  if (dica && CHAVE_MIDIA.test(dica)) p += 12;
  if (/master|playlist|\.m3u8$/i.test(u)) p += 4;
  if (/googlevideo|cloudfront|akamaized|fastly|b-cdn|mywallpaper|cloudflarestorage|hwcdn|r2\.dev/i.test(u)) p += 6;
  for (const re of IGNORADOS) if (re.test(u)) p -= 60;
  if (/\.php(\?|#|$)/i.test(u)) p -= 20;
  if (u.length > 600) p -= 8;
  return p;
}
function absolute(u, base) {
  if (!u) return null;
  const s = String(u).trim().replace(/\\\//g, "/");
  if (!s || s.length < 8) return null;
  let abs = s;
  if (s.startsWith("//")) abs = `https:${s}`;
  else if (!/^https?:\/\//i.test(s)) {
    if (!/^(\/|\.\/|\.\.\/)/.test(s)) return null;
    if (!base) return null;
    try {
      abs = new URL(s, base).href;
    } catch (_) {
      return null;
    }
  }
  if (!/^https?:\/\/[^/\s?#]+/i.test(abs)) return null;
  return abs;
}
function andaJson(no, dica, achados, profundidade = 0) {
  if (!no || profundidade > 6) return;
  if (typeof no === "string") {
    const u = absolute(no, null);
    if (u && (EXT_MIDIA.test(u) || dica && CHAVE_FORTE.test(dica))) achados.push({ url: u, dica, config: true });
    return;
  }
  if (Array.isArray(no)) {
    for (const item of no) andaJson(item, dica, achados, profundidade + 1);
    return;
  }
  if (typeof no === "object") {
    for (const [k, v] of Object.entries(no)) andaJson(v, k, achados, profundidade + 1);
  }
}
function coletar(entrada, opcoes) {
  const o = opcoes || {};
  const base = o.base || null;
  let texto = typeof entrada === "string" ? entrada.replace(/\\\//g, "/").replace(/&amp;/gi, "&") : "";
  const achados = [];
  const vistos = new Set();
  const poe = (u, dica, deConfig) => {
    const abs = absolute(u, base);
    if (!abs || vistos.has(abs)) return;
    const p = pontuar(abs, dica, deConfig);
    if (p < 0) return;
    vistos.add(abs);
    achados.push({ url: abs, dica: dica || "", nota: p });
  };
  if (!texto) return [];
  try {
    const doc = H.parse(texto);
    for (const tag of ["video", "source", "iframe", "embed", "object", "a", "meta", "link", "track"]) {
      for (const no of H.seleciona(doc, tag)) {
        for (const [k, v] of Object.entries(no.attrs)) {
          if (/^(src|data-src|data-video|data-url|data-file|data-hls|href|content|value|poster|data-poster)$/i.test(k)) poe(v, k);
        }
      }
    }
  } catch (_) {
  }
  const RE_MIDIA = /https?:\/\/[^\s"'<>)\\]+?\.(?:m3u8|mp4|mkv|webm|mov|flv|ts)(?:\?[^\s"'<>)\\]*)?/gi;
  for (const achado of texto.matchAll(RE_MIDIA)) {
    const antes = texto.slice(Math.max(0, achado.index - 40), achado.index);
    const chave = antes.match(/([A-Za-z_$][\w$]*)\s*[:=]\s*["']?\s*$/);
    poe(achado[0], chave ? chave[1] : "");
  }
  for (const achado of texto.matchAll(/https?:\/\/[^\s"'<>)]+?[?&][\w-]+=([^&"'\s<>)]*(?:\.m3u8|\.mp4)[^&"'\s<>)]*)/gi)) {
    try {
      poe(decodeURIComponent(achado[1]), achado[0]);
    } catch (_) {
      poe(achado[1], achado[0]);
    }
  }
  for (const achado of texto.matchAll(/https?:\/\/[^\s"'<>)]+?[?&]\w+=([^&"'\s<>)]*)/gi)) {
    const valor = achado[1];
    if (!/[%a-z0-9+/=]{16,}/i.test(valor) || !/%|%2f/i.test(valor)) continue;
    let alvo = null;
    try {
      alvo = decodeURIComponent(valor.replace(/\\\//g, "/"));
    } catch (_) {
      continue;
    }
    if (/^https?:\/\//i.test(alvo)) poe(alvo, achado[0]);
  }
  const doJson = [];
  let achouPorMarcador = false;
  for (const marcador of o.marcadores || [
    "window.",
    "var ",
    "let ",
    "const ",
    "sources",
    "playlist",
    "player",
    "config",
    "data"
  ]) {
    const achado = literal(texto, marcador);
    if (achado) {
      andaJson(achado, "", doJson, 0);
      if (doJson.length) achouPorMarcador = true;
    }
  }
  if (!achouPorMarcador) {
    for (const achado of texto.matchAll(/[{[]/g)) {
      if (achado.index > 4e5) break;
      const obj = literalEm(texto, achado.index);
      if (!obj) continue;
      andaJson(obj, "", doJson, 0);
      if (doJson.length) break;
    }
  }
  for (const achado of texto.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const obj = tryParse(achado[1]);
    if (obj) andaJson(obj, "contentUrl", doJson, 0);
  }
  for (const achado of doJson) poe(achado.url, achado.dica, true);
  const vistosFinal = new Set();
  return achados.filter((x) => vistosFinal.has(x.url) ? false : (vistosFinal.add(x.url), true)).sort((a, b) => b.nota - a.nota || a.url.length - b.url.length);
}
const PARECE_PLAYER = /(__play|\/play|\/player|\/embed|\/watch|\/e\/|\/v\/|player|embed|watch|\/tv\/)/i;
function paginasIntermedarias(html, base, teto = 8) {
  const vistas = new Map();
  const poe = (u, via) => {
    const abs = absolute(u, base);
    if (!abs || EXT_MIDIA.test(abs)) return;
    if (/\.(css|js|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)(\?|#|$)/i.test(abs)) return;
    for (const re of IGNORADOS) if (re.test(abs)) return;
    if (abs === base) return;
    const nota = (PARECE_PLAYER.test(abs) ? 20 : 0) + (via === "tag" ? 8 : 0) - abs.length / 1e3;
    const anterior = vistas.get(abs);
    if (anterior === void 0 || anterior < nota) vistas.set(abs, nota);
  };
  try {
    const doc = H.parse(html);
    for (const tag of ["iframe", "embed", "object", "source", "a", "video", "link", "meta"]) {
      for (const no of H.seleciona(doc, tag)) {
        for (const [k, v] of Object.entries(no.attrs)) {
          if (/^(src|href|data|data-src|data-url|data-file|poster|content|value)$/i.test(k)) poe(v, "tag");
        }
      }
    }
  } catch (_) {
  }
  for (const achado of String(html || "").replace(/&amp;/gi, "&").matchAll(/https?:\/\/[^\s"'<>)\\]*?(?:\/__play|\/play|\/player|\/embed|\/watch)[^\s"'<>)\\]*/gi)) {
    poe(achado[0], "texto");
  }
  return [...vistas.keys()].sort((a, b) => vistas.get(b) - vistas.get(a)).slice(0, teto);
}
const RE_REF = /(?:"(ref|referer|api|endpoint|stream_?url|src_?url|fetch)"|\b(ref|referer|api|endpoint|stream_?url|src_?url|fetch))\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{6,})/gi;
function refsDe(texto) {
  const saida = [];
  const vistos = new Set();
  for (const achado of String(texto || "").replace(/\\\//g, "/").matchAll(RE_REF)) {
    const cru = achado[achado.length - 1];
    const valor = cru[0] === '"' || cru[0] === "'" ? cru.slice(1, -1) : cru;
    if (!valor || valor.length < 6) continue;
    if (!/^(\/|https?:\/\/)/i.test(valor)) continue;
    if (vistos.has(valor)) continue;
    vistos.add(valor);
    saida.push(valor);
  }
  return saida;
}
const ASSINATURAS = [
  ["wordpress", /wp-content|wp-includes|wp-json|wp-embed/i, "WordPress"],
  ["graphql", /\/graphql|apollo|graphql-query/i, "GraphQL"],
  ["xtream", /player_api\.php|\/player_api\?/i, "Painel Xtream"],
  ["hlsjs", /hls\.js|hlsjs|new Hls\(/i, "player HLS (hls.js)"],
  ["videojs", /video\.js|videojs\(/i, "player Video.js"],
  ["jwplayer", /jwplayer|jwPlayer\(/i, "player JW"],
  ["dplayer", /dplayer/i, "player DPlayer"],
  ["plyr", /plyr/i, "player Plyr"],
  ["dash", /dash\.js|dashjs|application\/dash\+xml/i, "player MPEG-DASH"],
  ["elementor", /elementor/i, "montado no Elementor"],
  ["shopify", /cdn\.shopify/i, "Shopify"],
  ["cloudflare", /cf-browser-verification|just a moment|challenge-platform/i, "desafio do Cloudflare"],
  ["captcha", /recaptcha|hcaptcha|turnstile/i, "pede captcha"],
  ["vimeoclip", /player\.vimeo\.com/i, "player Vimeo"],
  ["youtube", /youtube\.com\/embed|ytimg\.com/i, "video no YouTube"]
];
function arquitetura(html, url) {
  const t = `${String(html || "").slice(0, 4e5)}
${url || ""}`;
  const encontradas = [];
  for (const [chave, re, nome] of ASSINATURAS) if (re.test(t)) encontradas.push({ chave, nome });
  let titulo = "";
  const doc = (() => {
    try {
      return H.parse(t.slice(0, 2e5));
    } catch (_) {
      return null;
    }
  })();
  if (doc) {
    const tt = H.um(doc, "title");
    if (tt) titulo = H.textoDe(tt).trim().slice(0, 120);
  }
  return {
    assinaturas: encontradas,
    nomes: encontradas.map((x) => x.nome),
    titulo,
    Length: t.length
  };
}
async function resolver(pagina, opcoes) {
  const o = opcoes || {};
  const teto = Number(o.maxPaginas || 4);
  const orcamentoMs = Number(o.ms || 8e3);
  const inicio = Date.now();
  const inicioFila = [pagina];
  const vistos = new Set();
  const erros = [];
  let melhor = null;
  while (inicioFila.length && Date.now() - inicio < orcamentoMs) {
    const atual = inicioFila.shift();
    if (!atual || vistos.has(atual)) continue;
    vistos.add(atual);
    if (vistos.size > teto) break;
    if (ehMidia(atual)) {
      const p = pontuar(atual, "");
      if (p >= 0 && (!melhor || p > melhor.nota)) melhor = { url: atual, nota: p, via: "direto" };
      continue;
    }
    const hoster = detectHost(atual);
    if (hoster && hoster !== "direct") {
      try {
        const resolvido = await resolveUrl(atual, o);
        if (resolvido) {
          const p = pontuar(resolvido, "hoster");
          if (p >= 0 && (!melhor || p > melhor.nota)) melhor = { url: resolvido, nota: p, via: `hoster:${hoster}` };
          continue;
        }
        erros.push(`${hoster}: sem video`);
      } catch (e) {
        erros.push(`${hoster}: ${e.message}`.slice(0, 90));
      }
      continue;
    }
    let html = "";
    const guardado = cache.get(atual);
    if (guardado) html = guardado;
    else {
      try {
        const sobra = Math.max(1500, orcamentoMs - (Date.now() - inicio));
        const res = await pegar(atual, {
          ms: Math.min(Number(o.timeout || 9e3), sobra),
          headers: Object.assign({ Referer: o.referer || origemDe(atual) }, o.headers || {})
        });
        if (!res.ok) {
          erros.push(`${res.status} ${atual.slice(0, 60)}`);
          continue;
        }
        html = await res.text();
        cache.set(atual, html);
      } catch (e) {
        erros.push(`${atual.slice(0, 50)}: ${e.message}`.slice(0, 90));
        continue;
      }
    }
    const achados = coletar(html, { base: atual, marcadores: o.marcadores });
    for (const c of achados) {
      if (!melhor || c.nota > melhor.nota) melhor = { url: c.url, nota: c.nota, via: "coleta" };
    }
    if (melhor && melhor.nota >= 55) break;
    if (!melhor) {
      for (const ref of refsDe(html).slice(0, 2)) {
        const alvo = absolute(ref, atual);
        if (!alvo || vistos.has(alvo)) continue;
        try {
          const sobra = Math.max(1200, orcamentoMs - (Date.now() - inicio));
          const res = await pegar(alvo, {
            metodo: "POST",
            ms: Math.min(Number(o.timeout || 9e3), sobra),
            headers: Object.assign({ Referer: atual }, { Accept: "application/json", "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" })
          });
          if (!res.ok) {
            erros.push(`ref ${res.status}`);
            continue;
          }
          const corpo = await res.text();
          for (const c of coletar(corpo, { base: atual })) {
            if (!melhor || c.nota > melhor.nota) melhor = { url: c.url, nota: c.nota, via: "ref" };
          }
          if (melhor) break;
        } catch (e) {
          erros.push(`ref: ${e.message}`.slice(0, 70));
        }
      }
    }
    if (melhor) break;
    for (const prox of paginasIntermedarias(html, atual)) inicioFila.push(prox);
  }
  if (!melhor) {
    const err = new Error(`extrator: nenhum video em ${pagina.slice(0, 70)}${erros.length ? ` (${erros.slice(0, 2).join("; ")})` : ""}`);
    err.erros = erros;
    err.visitas = vistos.size;
    throw err;
  }
  return melhor;
}
module.exports = {
  coletar,
  resolver,
  paginasIntermedarias,
  arquitetura,
  literal,
  literalEm,
  flexivel,
  pontuar,
  absolute,
  refsDe,
  EXT_MIDIA,
  CHAVE_MIDIA,
  IGNORADOS
};
