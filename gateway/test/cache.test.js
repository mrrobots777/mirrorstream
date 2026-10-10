"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Cache TTL/LRU/coalescimento (Task 3, spec §6). O relógio é injetado (`agora`)
// para os casos não dormirem: `t` anda a pulsos determinísticos. Cada caso cria
// um cache novo, então o avanço acumulado do caso anterior não vaza adiante.
const { criaCache } = require("../cache");

let t = 0;
const agora = () => t;

test("guarda e devolve dentro do TTL, e devolve null depois (spec §6)", () => {
  const c = criaCache({ agora });
  c.guarda("k", { streams: [1] }, 300000);
  assert.deepEqual(c.pega("k"), { streams: [1] });
  t += 300000;
  assert.equal(c.pega("k"), null);          // TTL do positivo completo: 300000
});

test("contagem separa positivo de negativo pelo streams.length", () => {
  const c = criaCache({ agora });
  c.guarda("a", { streams: [1] }, 1000); c.guarda("b", { streams: [] }, 1000);
  assert.equal(c.contagem("positivo"), 1);
  assert.equal(c.contagem("negativo"), 1);
});

test("LRU expulsa a entrada mais antiga ao passar do teto (spec §6)", () => {
  const c = criaCache({ teto: 2, agora });
  c.guarda("1", { streams: [] }, 1000); c.guarda("2", { streams: [] }, 1000);
  c.guarda("3", { streams: [] }, 1000);
  assert.equal(c.tamanho(), 2);
  assert.equal(c.pega("1"), null);          // a mais antiga saiu
  assert.ok(c.pega("2")); assert.ok(c.pega("3"));
});

test("ler uma entrada a renova na ordem LRU", () => {
  const c = criaCache({ teto: 2, agora });
  c.guarda("1", { streams: [] }, 1000); c.guarda("2", { streams: [] }, 1000);
  c.pega("1");                              // 1 deixa de ser a mais antiga
  c.guarda("3", { streams: [] }, 1000);
  assert.ok(c.pega("1"), "1 foi lida, não pode ser expulsa");
  assert.equal(c.pega("2"), null);
});

test("emVoo coalesce: duas chamadas iguais executam produz() uma vez (spec §11 caso 6)", async () => {
  const c = criaCache({ agora });
  let chamadas = 0;
  const produz = async () => { chamadas++; await new Promise(r => setTimeout(r, 10)); return { streams: ["x"] }; };
  const [a, b] = await Promise.all([c.emVoo("k", produz), c.emVoo("k", produz)]);
  assert.equal(chamadas, 1);
  assert.deepEqual(a, b);
  // depois de resolver, a chave sai de voo e pode calcular de novo
  await c.emVoo("k", produz);
  assert.equal(chamadas, 2);
});

// R3 — valor sem `streams` é negativo e não pode derrubar o /health (Task 7).
test("contagem trata valor sem streams como negativo, sem lançar (ruling R3)", () => {
  const c = criaCache({ agora });
  c.guarda("x", { qualquer: 1 }, 1000);
  assert.equal(c.contagem("negativo"), 1);
  assert.equal(c.contagem("positivo"), 0);
});

// Step 3 da brief: a chave sai em `finally` — produtor rejeitado não envenena a chave.
test("emVoo libera a chave depois de rejeitar, sem deixar promessa órfã", async () => {
  const c = criaCache({ agora });
  let chamadas = 0;
  const falha = async () => { chamadas++; throw new Error("fonte fora"); };
  await assert.rejects(c.emVoo("k", falha), /fonte fora/);
  const valor = await c.emVoo("k", async () => { chamadas++; return { streams: [] }; });
  assert.equal(chamadas, 2, "a chave em voo não pode ficar presa na promessa rejeitada");
  assert.deepEqual(valor, { streams: [] });
});
