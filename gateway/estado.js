"use strict";

// Estado por fonte do BeamUp (spec §7, §11 caso 8): um registro `{ falhas, ate }`
// por chave. Falhas consecutivas põem a fonte fora até `ate = agora + cooldownMs`;
// sucesso zera as falhas. Módulo puro — não importa nada; o relógio entra por
// `agora` para o teste não depender de tempo real.
function criaEstado(opcoes = {}) {
  const falhasLimite = opcoes.falhasLimite ?? 3;      // spec §7: 3 falhas
  const cooldownMs = opcoes.cooldownMs ?? 60000;      // spec §7: 60000 ms (COOLDOWN_FONTE)
  const agora = opcoes.agora ?? Date.now;
  const porChave = new Map();                         // chave → { falhas, ate }

  // Único caminho de limpeza (R12): um registro cujo `ate` já passou é tratado
  // como ausente por todos os leitores (emCooldown, emCooldownTotal,
  // candidatas) e por quem conta falhas — o reset é um só, nunca três cópias.
  function registro(chave) {
    let r = porChave.get(chave);
    if (!r) {
      r = { falhas: 0, ate: 0 };                      // ate = 0 ⇒ cooldown agendado nenhum
      porChave.set(chave, r);
    }
    if (r.ate > 0 && r.ate <= agora()) {
      r.falhas = 0;
      r.ate = 0;
    }
    return r;
  }

  function emCooldown(chave) {
    return registro(chave).ate > agora();             // limpo acima, a comparação decide
  }

  function sucesso(chave) {
    registro(chave).falhas = 0;                       // spec §7: sucesso ⇒ falhas = 0
  }

  function falha(chave) {
    const r = registro(chave);
    r.falhas += 1;
    if (r.falhas >= falhasLimite) {
      r.ate = agora() + cooldownMs;                   // spec §7: falhas >= 3 ⇒ agenda ate
      r.falhas = 0;                                   // e zera para a próxima janela
    }
  }

  function emCooldownTotal() {
    let total = 0;
    for (const chave of porChave.keys()) {
      if (emCooldown(chave)) total += 1;
    }
    return total;
  }

  function candidatas(chaves) {
    const saudaveis = chaves.filter((chave) => !emCooldown(chave));
    return saudaveis.length > 0 ? saudaveis : chaves.slice();   // vazia ⇒ todas voltam (spec §7)
  }

  return { sucesso, falha, emCooldown, emCooldownTotal, candidatas };
}

module.exports = { criaEstado };
