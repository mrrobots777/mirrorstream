const { pegar } = require("./http");
const cache = cacheCurto(80, 30 * 60 * 1e3);
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
async function baixa(url, opcoes) {
  const o = opcoes || {};
  const headers = Object.assign({ Referer: origemDe(url) }, o.headers || {});
  return pegar(url, { metodo: o.metodo, corpo: o.corpo, ms: o.ms || 8e3, headers });
}
const HOSTERS = {
  mediafire: {
    patterns: [/mediafire\.com\/file\//i],
    resolve: resolveMediaFire
  },
  streamtape: {
    patterns: [/streamtape\.com/i, /strtape\./i, /stape\./i],
    resolve: resolveStreamtape
  },
  fembed: {
    patterns: [/fembed\.com/i, /fcdn\.xyz/i, /feurl\.com/i, /sbn\.gg/i],
    resolve: resolveFembed
  },
  vidcloud: {
    patterns: [/vidcloud\.pro/i, /vidcloud\.co/i, /vidstreaming\.io/i],
    resolve: resolveVidCloud
  },
  sendvid: {
    patterns: [/sendvid\.com/i, /sendvid\.co/i],
    resolve: resolveSendVid
  },
  mixdrop: {
    patterns: [/mixdrop\.co/i, /mixdrop\.to/i, /mixdrop\.ch/i],
    resolve: resolveMixDrop
  },
  doodstream: {
    patterns: [/doodstream\.com/i, /dood\./i, /dooood\.com/i, /doodpay\.com/i],
    resolve: resolveDood
  },
  streamlare: {
    patterns: [/streamlare\.com/i, /slmaxed\.com/i, /sltestbed\.com/i],
    resolve: resolveStreamlare
  },
  streamsb: {
    patterns: [/streamsb\.com/i, /sbplay\./i, /sbplay1\.xyz/i],
    resolve: resolveStreamSB
  },
  vidplay: {
    patterns: [/vidplay\.site/i, /myviatv\.com/i, /vidplay\.link/i],
    resolve: resolveVidPlay
  },
  filemoon: {
    patterns: [/filemoon\.sx/i, /filemoon\.to/i, /filemoon\.link/i],
    resolve: resolveFileMoon
  },
  mp4upload: {
    patterns: [/mp4upload\.com/i],
    resolve: resolveMP4Upload
  },
  streamwish: {
    patterns: [/streamwish\.com/i, /swhd\.xyz/i, /wsd\.href\.online/i],
    resolve: resolveStreamWish
  },
  veoh: {
    patterns: [/veoh\.com/i],
    resolve: resolveVeoh
  },
  okru: {
    patterns: [/ok\.ru/i, /odnoklassniki\.ru/i],
    resolve: resolveOKRu
  }
};
const MIDIA = /\.(m3u8|mp4|mkv|webm|mov|avi|flv|ts)(\?|#|$)/i;
function ehMidia(url) {
  return MIDIA.test(String(url || ""));
}
function detectHost(url) {
  const u = (url || "").toLowerCase();
  for (const [name, host] of Object.entries(HOSTERS)) {
    for (const pat of host.patterns) {
      if (pat.test(u)) return name;
    }
  }
  if (/\.(mp4|m3u8|mkv|avi|mov|webm)(\?|$)/i.test(u)) return "direct";
  return null;
}
async function resolveMediaFire(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const btn = html.match(/id="downloadButton"[^>]*href="([^"]+)"/);
    if (btn) return btn[1];
    const direct = html.match(/"?(https?:\/\/[^"'\s]+download[^"'\s]*\.mp4[^"'\s]*)/i);
    if (direct) return direct[1];
    const anyLink = html.match(/href="(https?:\/\/[^"']*\.mediafire\.com\/[^"]+)"/i);
    if (anyLink) return anyLink[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveStreamtape(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const tokenMatch = html.match(/\/gettoken\/([^'?]+)/);
    if (tokenMatch) {
      const base = new URL(url);
      const tokenUrl = `${base.origin}/gettoken/${tokenMatch[1]}`;
      return tokenUrl;
    }
    const scriptMatch = html.match(/(https?:\/\/[^"']+\/gettoken\/[^"']+)/);
    if (scriptMatch) return scriptMatch[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveFembed(url) {
  try {
    let apiBase = url.replace(/\/v\//, "/api/").replace(/\/f\//, "/api/");
    if (!apiBase.includes("/api/")) {
      const res = await baixa(url, { ms: 1e4 });
      if (!res.ok) return null;
      const html = await res.text();
      const apiMatch = html.match(/(https?:\/\/[^"']+\/api\/[^"']+)/);
      if (apiMatch) apiBase = apiMatch[1];
      else return null;
    }
    const apiRes = await baixa(apiBase, { ms: 1e4 });
    if (!apiRes.ok) return null;
    const data = await apiRes.json();
    if (data.data && Array.isArray(data.data)) {
      const best = data.data.sort((a, b) => (b.label || "").localeCompare(a.label || ""))[0];
      if (best && best.file) return best.file;
    }
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveVidCloud(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const sources = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);
    if (sources) return sources[1];
    const mp4 = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i);
    if (mp4) return mp4[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveSendVid(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const mp4 = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i);
    if (mp4) return mp4[1];
    const source = html.match(/source\s+src\s*=\s*["'](https?:\/\/[^"']+)/i);
    if (source) return source[1];
    const video = html.match(/(https?:\/\/[^"']+sendvid[^"']+\.mp4)/i);
    if (video) return video[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveMixDrop(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[^{]*\{[^}]*\}[^)]*\)/s);
    if (packed) {
      const unpacked = unpackPacker(packed[0]);
      if (unpacked) {
        const videoUrl = unpacked.match(/(?:file|src|source)\s*[=:]\s*["'](https?:\/\/[^"']+)/i);
        if (videoUrl) return videoUrl[1];
      }
    }
    const direct = html.match(/(https?:\/\/[^"']+\.mp4[^"']*)/i);
    if (direct) return direct[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveDood(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const tokenMatch = html.match(/\$\.{2}\s*\+\s*(\w+)\s*\(\s*["']([^"']+)["']\s*\)/);
    if (tokenMatch) {
      const passUrl = html.match(/(https?:\/\/[^"']+\?token=[^"']+)/);
      if (passUrl) return passUrl[1];
    }
    const direct = html.match(/(https?:\/\/[^"']+\.mp4[^"']*)/i);
    if (direct) return direct[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveStreamlare(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const token = html.match(/token\s*=\s*["']([^"']+)["']/);
    const id = html.match(/\/v\/([a-zA-Z0-9]+)/);
    if (token && id) {
      const origin = new URL(url).origin;
      const apiRes = await baixa(`${origin}/api/v1/stream/${id[1]}`, {
        metodo: "POST",
        headers: { "Content-Type": "application/json" },
        corpo: JSON.stringify({ token: token[1] }),
        ms: 1e4
      });
      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data.result && data.result.stream) return data.result.stream;
        if (data.result && data.result.file) return data.result.file;
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveStreamSB(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[^{]*\{[^}]*\}[^)]*\)/s);
    if (packed) {
      const unpacked = unpackPacker(packed[0]);
      if (unpacked) {
        const m3u8 = unpacked.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
        if (m3u8) return m3u8[1];
      }
    }
    const stream = html.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
    if (stream) return stream[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveVidPlay(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[^{]*\{[^}]*\}[^)]*\)/s);
    if (packed) {
      const unpacked = unpackPacker(packed[0]);
      if (unpacked) {
        const m3u8 = unpacked.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
        if (m3u8) return m3u8[1];
      }
    }
    const sources = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);
    if (sources) return sources[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveFileMoon(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[^{]*\{[^}]*\}[^)]*\)/s);
    if (packed) {
      const unpacked = unpackPacker(packed[0]);
      if (unpacked) {
        const m3u8 = unpacked.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
        if (m3u8) return m3u8[1];
      }
    }
    const sources = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);
    if (sources) return sources[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveMP4Upload(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[^{]*\{[^}]*\}[^)]*\)/s);
    if (packed) {
      const unpacked = unpackPacker(packed[0]);
      if (unpacked) {
        const mp4 = unpacked.match(/(?:src|file|source)\s*[=:]\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i);
        if (mp4) return mp4[1];
      }
    }
    const direct = html.match(/(https?:\/\/[^"']+\.mp4[^"']*)/i);
    if (direct) return direct[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveStreamWish(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const packed = html.match(/eval\(function\(p,a,c,k,e,d\)[^{]*\{[^}]*\}[^)]*\)/s);
    if (packed) {
      const unpacked = unpackPacker(packed[0]);
      if (unpacked) {
        const mp4 = unpacked.match(/(?:src|file|source)\s*[=:]\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i);
        if (mp4) return mp4[1];
        const m3u8 = unpacked.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
        if (m3u8) return m3u8[1];
      }
    }
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveVeoh(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const videoSrc = html.match(/"videoUrl"\s*:\s*"(https?:\/\/[^"]+)"/i);
    if (videoSrc) return videoSrc[1];
    const mp4 = html.match(/(https?:\/\/[^"']+\.mp4[^"']*)/i);
    if (mp4) return mp4[1];
    return null;
  } catch (_) {
    return null;
  }
}
async function resolveOKRu(url) {
  try {
    const res = await baixa(url, { ms: 12e3 });
    if (!res.ok) return null;
    const html = await res.text();
    const mp4 = html.match(/"videoUrl"\s*:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/i);
    if (mp4) return mp4[1];
    const hd = html.match(/"videoUrl"\s*:\s*"(https?:\/\/[^"]+)"/i);
    if (hd) return hd[1];
    return null;
  } catch (_) {
    return null;
  }
}
function unpackPacker(code) {
  try {
    let baseN2 = function(n, b) {
      const d = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
      return n < b ? d[n] : baseN2(Math.floor(n / b), b) + d[n % b];
    };
    var baseN = baseN2;
    const m = code.match(/\}\s*\(\s*'(.*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*)'\.split\('\|'\)/s);
    if (!m) return null;
    const [, p, aStr, cStr, kStr] = m;
    const a = parseInt(aStr, 10), c = parseInt(cStr, 10), k = kStr.split("|");
    const sym = {};
    for (let i = 0; i < c; i++) sym[baseN2(i, a)] = k[i] || baseN2(i, a);
    return p.replace(/\b\w+\b/g, (w) => sym[w] || w);
  } catch (_) {
    return null;
  }
}
async function resolveUrl(url, opts = {}) {
  if (!url) return null;
  const cacheKey = `resolver:${url}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const host = detectHost(url);
  if (!host) return null;
  if (host === "direct") {
    cache.set(cacheKey, url);
    return url;
  }
  const hoster = HOSTERS[host];
  if (!hoster || !hoster.resolve) return null;
  try {
    const result = await hoster.resolve(url, opts);
    if (result) {
      cache.set(cacheKey, result);
      return result;
    }
  } catch (_) {
  }
  return null;
}
module.exports = { resolveUrl, detectHost, HOSTERS, ehMidia };
