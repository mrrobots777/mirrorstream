"use strict";

// Configuração do gateway. Este módulo só roda em Node (não entra no bundle do
// dispositivo), então process.env é permitido aqui — spec §8.

const VERSAO = "1.0.0";
const HOST = "0.0.0.0";

const PADRAO_PORTA = 7000;
const PADRAO_ORCA_MS = 6000;
const MIN_ORCA_MS = 1000;
const MAX_ORCA_MS = 9000;

// Mesmos nomes de globalThis que os scrapers já leem — a lista da
// edge-worker-entry.js, só mudando o lugar (CF Secrets → ambiente do BeamUp).
const CHAVES_DE_CONFIG = [
  "TMDB_API_KEY",
  "MIRROR_SPC_USER", "MIRROR_SPC_PASS",
  "MIRROR_BLZ_USER", "MIRROR_BLZ_PASS", "MIRROR_BLZ_CATALOGO",
  "MIRROR_ATO_USER", "MIRROR_ATO_PASS",
  "MIRROR_INDEX_BASE",
  "MIRROR_EDGE_MODE",
  "MIRROR_QUALIDADE"
];

function inteiroDe(chave, padrao) {
  const bruto = process.env[chave];
  if (bruto === undefined || String(bruto).trim() === "") return padrao;
  const n = Number(bruto);
  return Number.isFinite(n) ? Math.trunc(n) : padrao;
}

function apara(valor, min, max) {
  return Math.min(max, Math.max(min, valor));
}

const PORTA = inteiroDe("PORT", PADRAO_PORTA);
const ORCA_MS = apara(inteiroDe("MIRROR_ORCA_MS", PADRAO_ORCA_MS), MIN_ORCA_MS, MAX_ORCA_MS);

function carregaEnv() {
  for (const chave of CHAVES_DE_CONFIG) {
    const valor = process.env[chave];
    if (typeof valor === "string" && valor !== "") globalThis[chave] = valor;
  }
}

module.exports = { carregaEnv, PORTA, HOST, ORCA_MS, VERSAO };
