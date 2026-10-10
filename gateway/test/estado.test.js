"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Estado por fonte: falhas, janela de cooldown e candidatas (Task 4, spec §7,
// §11 caso 8). O relógio é injetado (`agora`) para a janela de 60000 ms não
// dormir: `t` anda a pulsos determinísticos. Cada caso cria um estado novo,
// então o avanço acumulado do caso anterior não vaza adiante.
const { criaEstado } = require("../estado");

let t = 0;
const agora = () => t;

test("3 falhas põem a fonte fora por 60000 ms (spec §7, spec §11 caso 8)", () => {
  const e = criaEstado({ agora });
  e.falha("spc"); e.falha("spc"); assert.equal(e.emCooldown("spc"), false);
  e.falha("spc");
  assert.equal(e.emCooldown("spc"), true);
  assert.equal(e.emCooldownTotal(), 1);
  t += 59999; assert.equal(e.emCooldown("spc"), true);
  t += 1;     assert.equal(e.emCooldown("spc"), false);   // voltou sozinha
});

test("sucesso zera as falhas acumuladas", () => {
  const e = criaEstado({ agora });
  e.falha("blz"); e.falha("blz"); e.sucesso("blz");
  e.falha("blz"); e.falha("blz");
  assert.equal(e.emCooldown("blz"), false);   // seria 4 falhas, mas o sucesso zerou
});

test("candidatas remove as em cooldown, e se sobrar vazio devolve todas (spec §7)", () => {
  const e = criaEstado({ agora });
  e.falha("a"); e.falha("a"); e.falha("a");
  assert.deepEqual(e.candidatas(["a", "b"]), ["b"]);
  e.falha("b"); e.falha("b"); e.falha("b");
  assert.deepEqual(e.candidatas(["a", "b"]), ["a", "b"], "sem nenhuma saudável, todas voltam");
});

// R12 — os três leitores (emCooldown, candidatas, emCooldownTotal) tratam o
// registro expirado como ausente e enxergam o mesmo reset: expirada, a fonte
// sai do total e uma falha nova conta do zero, sem reativar o cooldown na hora.
test("janela expirada zera o total e a contagem de falhas recomeça (R12)", () => {
  const e = criaEstado({ agora });
  e.falha("gtv"); e.falha("gtv"); e.falha("gtv");
  assert.equal(e.emCooldownTotal(), 1);
  t += 60000;                                    // fronteira exata: ate == agora, saiu
  assert.equal(e.emCooldownTotal(), 0, "janela passou: não conta mais");
  assert.equal(e.emCooldown("gtv"), false);
  assert.deepEqual(e.candidatas(["gtv", "out"]), ["gtv", "out"]);
  e.falha("gtv");                                // 1 falha nova não re-entra em cooldown
  assert.equal(e.emCooldown("gtv"), false);
  assert.equal(e.emCooldownTotal(), 0);
});
