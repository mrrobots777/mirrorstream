"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Carregamento e seleção das fontes (Task 2). Quem conhece o registro do plugin
// é o gateway: este arquivo não importa `plugin/src/core/fontes` direto —
// `chaves()` e `tiposDe()` existem no módulo justamente para o teste não ter
// que montar caminho próprio. Os quatro casos dependem da ordem do node:test
// (sequencial dentro do arquivo): o primeiro dá boot, os outros leem o estado
// que ficou carregado.
const fontes = require("../fontes");

test("o boot carrega todos os scrapers ativos do registro (spec §11 caso 12)", () => {
  const r = fontes.carrega();
  assert.deepEqual(r.falhas, [], `scrapers que falharam: ${JSON.stringify(r.falhas)}`);   // deepEqual: compara conteúdo, não referência
  assert.equal(r.ativas, fontes.total());
  assert.ok(r.ativas >= 9, `esperava >= 9 fontes ativas, veio ${r.ativas}`);
});
test("elegiveis mantém a ORDEM do registro e filtra por tipo", () => {
  const filme = fontes.elegiveis("movie").map(f => f.chave);
  const tv = fontes.elegiveis("tv").map(f => f.chave);
  assert.deepEqual(filme, fontes.chaves().filter(c => fontes.tiposDe(c).includes("movie") || !fontes.tiposDe(c).length));
  assert.deepEqual(tv, fontes.chaves().filter(c => fontes.tiposDe(c).includes("tv") || !fontes.tiposDe(c).length));
  assert.deepEqual(filme, fontes.chaves().filter(c => filme.includes(c)), "filtra, mas preserva a ORDEM");
  assert.notDeepEqual(filme, tv);          // filme e tv têm conjuntos diferentes (só 2 animes são tv-only)
});
test("fonte desativada (ato) não aparece em nenhuma seleção", () => {
  const todas = [...fontes.elegiveis("movie"), ...fontes.elegiveis("tv")].map(f => f.chave);
  assert.ok(!todas.includes("ato"), "ato está com ativo:false no registro");
});
test("todo getStreams carregado é função", () => {
  for (const f of [...fontes.elegiveis("movie"), ...fontes.elegiveis("tv")]) {
    assert.equal(typeof f.getStreams, "function", f.chave);
  }
});
