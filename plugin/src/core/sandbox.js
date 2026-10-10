const TEMPO_FETCH_PADRAO_MS = 8000;
const TEMPO_FETCH_MAX_MS = 60000;
const TETO_CORPO_BYTES = 1048576;
const TETO_CORPO_LIMITED_BYTES = 524288;

function novo(totalMs) {
  const inicio = Date.now();
  const limite = inicio + Math.max(1, Number(totalMs) || 1);
  return {
    inicio,
    limite,
    gasto: () => Date.now() - inicio,
    passou: () => Date.now() > limite,
    // Quanto ainda resta do orcamento, sem teto de 8 s. `ms()` e o que uma CHAMADA
    // deve pedir; `sobra()` e o que a invocacao ainda tem. Misturar os dois dava
    // `Math.min(1, sobra) === 1` num guarda "faltam 1,5 s?" — que disparava sempre.
    sobra: () => limite - Date.now(),
    ms: () => Math.max(1, Math.min(TEMPO_FETCH_PADRAO_MS, limite - Date.now()))
  };
}

module.exports = {
  TEMPO_FETCH_PADRAO_MS,
  TEMPO_FETCH_MAX_MS,
  TETO_CORPO_BYTES,
  TETO_CORPO_LIMITED_BYTES,
  novo
};