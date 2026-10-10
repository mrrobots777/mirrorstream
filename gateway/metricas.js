"use strict";

// Métricas do gateway (Task 5, spec §4): contadores puros + renderizador do
// texto Prometheus de /metrics. Módulo autocontido — não importa nada.
// `cache` e `resultado` saem pré-semeados em 0: uma série que só nasce depois
// do primeiro evento quebra rate() no Prometheus.

const VALORES_CACHE = ["hit", "miss", "parcial", "negativo", "erro"];
const VALORES_RESULTADO = ["ok", "vazio", "erro"];

// Escapa o valor de um rótulo conforme o formato de texto 0.0.4.
function escapa(valor) {
  return String(valor)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function criaMetricas() {
  const porCache = Object.create(null);
  for (const valor of VALORES_CACHE) porCache[valor] = 0;

  const porFonte = Object.create(null);          // nome → { ok, vazio, erro }
  const tempos = { soma: 0, total: 0 };

  function resolve(valor) {
    if (VALORES_CACHE.includes(valor)) porCache[valor] += 1;
  }

  function fonte(nome, resultado) {
    if (!VALORES_RESULTADO.includes(resultado)) return;
    if (!(nome in porFonte)) {                   // primeira vista: semeia os três
      const semeado = Object.create(null);
      for (const valor of VALORES_RESULTADO) semeado[valor] = 0;
      porFonte[nome] = semeado;
    }
    porFonte[nome][resultado] += 1;
  }

  function resposta(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) return;
    tempos.soma += ms;
    tempos.total += 1;
  }

  function render(info) {
    const linhas = [
      "gateway_up 1",
      `gateway_fontes_total ${info.fontes.total}`,
      `gateway_fontes_ativas ${info.fontes.ativas}`,
      `gateway_fontes_em_cooldown ${info.fontes.em_cooldown}`,
      `gateway_cache_entradas{tipo="positivo"} ${info.cache.positivo}`,
      `gateway_cache_entradas{tipo="negativo"} ${info.cache.negativo}`,
    ];
    for (const valor of VALORES_CACHE) {
      linhas.push(`gateway_resolve_total{cache="${valor}"} ${porCache[valor]}`);
    }
    for (const nome of Object.keys(porFonte)) {   // ordem da 1ª vista da fonte
      for (const resultado of VALORES_RESULTADO) {
        linhas.push(
          `gateway_fonte_total{fonte="${escapa(nome)}",resultado="${resultado}"} ${porFonte[nome][resultado]}`
        );
      }
    }
    linhas.push(`gateway_resposta_ms_soma ${tempos.soma}`);
    linhas.push(`gateway_resposta_ms_total ${tempos.total}`);
    return linhas.join("\n") + "\n";              // termina com \n
  }

  return { resolve, fonte, resposta, render };
}

module.exports = { criaMetricas };
