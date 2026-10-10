#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const fontes = require("../../src/core/fontes");
const { PADRAO, chaveTmdb } = require("./casos");
const { um: provar } = require("./provar-links");
const { agrupaPorCategoria, linhaPorCategoria } = require("./resumo");

const { RAIZ: raiz } = require("../_caminhos");
const logDir = process.env.MONITOR_LOG_DIR || path.join(raiz, "logs");
const agora = new Date();
const stamp = agora.toISOString().replace(/[:.]/g, "-");
const jsonl = path.join(logDir, `fontes-${stamp}.jsonl`);
const resumoPath = path.join(logDir, `resumo-${stamp}.json`);
const timeoutMs = Number(process.env.MONITOR_TIMEOUT_MS) || 65000;
const probeMax = Math.max(0, Number(process.env.PROBE_MAX) || 2);
const alvo = process.env.FONTES
  ? process.env.FONTES.split(",").map((x) => x.trim()).filter((x) => fontes.FONTES[x])
  : fontes.chaves();

fs.mkdirSync(logDir, { recursive: true });
if (chaveTmdb() && !globalThis.TMDB_API_KEY) globalThis.TMDB_API_KEY = chaveTmdb();
if (process.env.MIRROR_INDEX_BASE) globalThis.MIRROR_INDEX_BASE = String(process.env.MIRROR_INDEX_BASE).replace(/\/+$/, "");
if (process.env.MIRROR_EDGE_MODE) globalThis.MIRROR_EDGE_MODE = process.env.MIRROR_EDGE_MODE;

function linha(record) {
  fs.appendFileSync(jsonl, `${JSON.stringify(record)}\n`);
  console.log(`${record.fonte.padEnd(4)} ${record.status.padEnd(8)} ${String(record.ms).padStart(6)}ms streams=${record.streams} vivos=${record.vivos} erro=${record.erro || "-"}`);
}
function comTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`monitor timeout ${ms}ms`)), ms))
  ]);
}
async function testa(fonte) {
  const caso = PADRAO[fonte];
  const inicio = Date.now();
  const base = { momento: new Date().toISOString(), fonte, caso, edge: process.env.MIRROR_EDGE_MODE || "auto" };
  try {
    const modulo = require(path.join(raiz, "dist", fontes.bundleDe(fonte)));
    const lista = await comTimeout(modulo.getStreams(...caso), timeoutMs);
    const streams = Array.isArray(lista) ? lista : [];
    const amostras = streams.slice(0, probeMax);
    const provas = await Promise.all(amostras.map((s) => provar(s)));
    const vivos = provas.filter((p) => ["ok", "INDECISO", "BLOQUEADO"].includes(p.veredito)).length;
    const ruins = provas.filter((p) => ["MORTO", "RUIM", "STUB", "VAZIO"].includes(p.veredito)).length;
    const status = streams.length && vivos ? "ok" : streams.length ? "sem-link" : "vazio";
    return { ...base, status, ms: Date.now() - inicio, streams: streams.length, vivos, ruins, qualidades: streams.filter((s) => s && s.quality).length, provas: provas.map((p) => ({ veredito: p.veredito, status: p.status, ms: p.ms, motivo: p.motivo })) };
  } catch (e) {
    return { ...base, status: /timeout/i.test(String(e)) ? "timeout" : "erro", ms: Date.now() - inicio, streams: -1, vivos: 0, ruins: 0, qualidades: 0, erro: String(e && e.message || e).slice(0, 500) };
  }
}
(async () => {
  const inicio = Date.now();
  const resultados = [];
  for (const fonte of alvo) {
    const r = await testa(fonte);
    resultados.push(r);
    linha(r);
  }
  const resumo = {
    geradoEm: new Date().toISOString(),
    duracaoMs: Date.now() - inicio,
    fontes: resultados.length,
    ok: resultados.filter((r) => r.status === "ok").length,
    vazias: resultados.filter((r) => r.status === "vazio").length,
    semLink: resultados.filter((r) => r.status === "sem-link").length,
    erros: resultados.filter((r) => ["erro", "timeout"].includes(r.status)).length,
    resultados,
    // O agregado tambem vai para o JSON: e' ele que o CI compara entre execucoes, porque
    // uma fonte pode cair e subir enquanto a categoria segue de pe.
    porCategoria: agrupaPorCategoria(
      resultados.map((r) => ({ chave: r.fonte, ok: r.status === "ok" })),
      fontes.diretorioDe
    ),
    jsonl
  };
  fs.writeFileSync(resumoPath, `${JSON.stringify(resumo, null, 2)}\n`);
  console.log(`resumo=${resumoPath}`);
  console.log(`resultado: ${resumo.ok} ok, ${resumo.vazias} vazias, ${resumo.semLink} sem-link, ${resumo.erros} erros`);
  console.log(`por categoria: ${linhaPorCategoria(resumo.porCategoria)}`);
  process.exitCode = resumo.ok === 0 && resumo.fontes > 0 ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
