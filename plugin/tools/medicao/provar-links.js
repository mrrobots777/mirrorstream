const { UA } = require("../../src/lib/ua");

const FAIXA = "bytes=0-2047";
const MORTOS = new Set([403, 404, 410, 451]);
// "Nao deu para saber" NAO e "morreu" — a mesma regra do runtime (decisoes 131/134).
// MEDIDO 02/10/2026: o CDN do VZR responde 429 a este IP de datacenter; o link
// continua valendo para o aparelho do usuario, que baixa do IP residencial dele.
// Contar isso como link morto fazia a bateria mentir sobre a fonte.
const INDECISOS = new Set([408, 425, 429, 999]);
// O painel responde 200 com uma pagina de bloqueio para IP de datacenter. E informacao
// util (a origem recusou ESTE servidor), mas nao prova que o link esteja morto.
const BLOQUEIO = /welcome to nginx|anonymous proxy|access denied|unauthorized|cloudflare/i;
// Detecta o stub pelo HOST, nao pelo nome do stream: o nome agora e o titulo do
// conteudo (contrato do app), entao a chave por fonte parou de valer.
const STUB = { "4x4u29c.autos": 235 };

function erroDe(e) {
  return /timeout|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted|fetch failed|network/i.test(String((e && e.message) || e));
}

function parecePaginaDeErro(buf, tipo) {
  const t = String(tipo || "").toLowerCase();
  if (t.includes("text/html")) return true;
  const inicio = Buffer.from(buf).subarray(0, 512).toString("latin1").toLowerCase();
  return /<!doctype html|<html|forbidden|error 40|not found/.test(inicio);
}

function hostDe(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}

async function um(stream) {
  const url = typeof stream.url === "object" && stream.url ? stream.url.url : stream.url;
  const t0 = Date.now();
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), 15000);
  const base = {
    fonte: stream.name || "?",
    qualidade: stream.quality || "-",
    url: String(url || "").slice(0, 110)
  };
  try {
    const r = await fetch(url, {
      headers: Object.assign({ Range: FAIXA, "User-Agent": UA }, (stream.headers || {})),
      signal: ctrl.signal,
      redirect: "follow"
    });
    const tipo = r.headers.get("content-type") || "";
    const cr = r.headers.get("content-range") || "";
    const buf = r.status === 206 || r.status === 200 ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
    const st = STUB[hostDe(url)];
    let veredito = "ok";
    let motivo = "";
    if (INDECISOS.has(r.status)) { veredito = "INDECISO"; motivo = `HTTP ${r.status} — limite de taxa, nao prova de morte`; }
    else if (MORTOS.has(r.status)) { veredito = "MORTO"; motivo = `HTTP ${r.status}`; }
    else if (r.status >= 500) { veredito = "MORTO"; motivo = `HTTP ${r.status} (5xx)`; }
    else if (!r.ok) { veredito = "RUIM"; motivo = `HTTP ${r.status}`; }
    else if (parecePaginaDeErro(buf, tipo)) {
      const txt = Buffer.from(buf).subarray(0, 512).toString("latin1");
      const bloqueio = BLOQUEIO.test(txt);
      veredito = bloqueio ? "BLOQUEADO" : "RUIM";
      motivo = bloqueio
        ? `a origem recusou este IP de datacenter (${buf.length} B) — o link pode tocar no aparelho`
        : `pagina de erro em ${tipo || "?"} (${buf.length} B)`;
    }
    else if (cr && !/\bbytes\s+\d+-\d+\/\d+/i.test(cr)) { veredito = "RUIM"; motivo = `Content-Range invalido: ${cr}`; }
    else if (st && buf.length <= st) { veredito = "STUB"; motivo = `${buf.length} B — o painel respondeu o stub nginx, nao o video`; }
    else if (buf.length === 0) { veredito = "VAZIO"; motivo = "0 bytes com resposta 2xx"; }
    return Object.assign(base, {
      status: r.status,
      bytes: buf.length,
      faixa: r.status === 206 ? "206" : "200",
      ms: Date.now() - t0,
      veredito,
      motivo
    });
  } catch (e) {
    return Object.assign(base, {
      status: 0,
      bytes: 0,
      faixa: "-",
      ms: Date.now() - t0,
      veredito: erroDe(e) ? "REDE" : "ERRO",
      motivo: String((e && e.message) || e).slice(0, 90)
    });
  } finally {
    clearTimeout(relogio);
  }
}

async function probe(lista, opcoes) {
  const o = opcoes || {};
  const conc = Math.max(1, Number(o.conc) || 4);
  const fila = lista.slice();
  const conta = {};
  console.log(`\n[probe] ${fila.length} url(s), conc ${conc}, Range ${FAIXA}`);
  console.log("[probe] " + "fonte  qual      status bytes  faixa  ms     veredito  motivo");
  while (fila.length) {
    const lote = [];
    for (let i = 0; i < conc && fila.length; i++) lote.push(fila.shift());
    const res = await Promise.all(lote.map(um));
    for (const r of res) {
      conta[r.veredito] = (conta[r.veredito] || 0) + 1;
      console.log(
        `[probe] ${String(r.fonte).padEnd(6)} ${String(r.qualidade).padEnd(9)} ${String(r.status).padEnd(6)} ${String(r.bytes).padEnd(6)} ${r.faixa.padEnd(6)} ${String(r.ms).padEnd(6)} ${r.veredito.padEnd(9)} ${r.motivo}`
      );
    }
  }
  console.log(`[probe] ${JSON.stringify(conta)}`);
  return conta;
}

module.exports = { probe, um };