"use strict";

// Cache em memória do BeamUp (spec §6): TTL por entrada, expulsão LRU com teto
// e coalescimento de consultas em voo por chave. Módulo puro — não importa nada;
// o relógio entra por `agora` para o teste não depender de tempo real.
function criaCache(opcoes = {}) {
  const teto = opcoes.teto ?? 2000;              // spec §6: teto de 2000 entradas
  const agora = opcoes.agora ?? Date.now;
  const entradas = new Map();                    // chave → { valor, expira } (ordem = LRU)
  const voos = new Map();                        // chave → Promise em voo

  function pega(chave) {
    const e = entradas.get(chave);
    if (!e) return null;
    if (e.expira <= agora()) {
      entradas.delete(chave);                    // expirado é apagado, não só ignorado
      return null;
    }
    entradas.delete(chave);                      // LRU: reler move a chave para o fim
    entradas.set(chave, e);
    return e.valor;
  }

  function guarda(chave, valor, ttlMs) {
    entradas.delete(chave);                      // re-guardar reposiciona no fim
    entradas.set(chave, { valor, expira: agora() + ttlMs });
    while (entradas.size > teto) {
      entradas.delete(entradas.keys().next().value);   // expulsa a mais antiga; teto não é erro
    }
  }

  function emVoo(chave, produz) {
    const existente = voos.get(chave);
    if (existente) return existente;             // coalescimento: mesma consulta em voo reusa a promessa
    const promessa = Promise.resolve()
      .then(produz)
      .finally(() => voos.delete(chave));        // sai em `finally`: rejeição não envenena a chave
    voos.set(chave, promessa);
    return promessa;
  }

  // positivo = valor.streams.length > 0; valor sem `streams` é negativo (ruling R3).
  function contagem(tipo) {
    let n = 0;
    for (const e of entradas.values()) {
      const positivo = !!(e.valor && Array.isArray(e.valor.streams) && e.valor.streams.length > 0);
      if ((tipo === "positivo") === positivo) n++;
    }
    return n;
  }

  function tamanho() {
    return entradas.size;
  }

  return { pega, guarda, emVoo, contagem, tamanho };
}

module.exports = { criaCache };
