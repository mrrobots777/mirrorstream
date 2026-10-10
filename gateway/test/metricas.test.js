"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Contadores e texto /metrics (Task 5, spec §4, spec §11 caso 10). O módulo não
// importa nada: contadores de objetos com rótulos fixos + um render que só
// monta o texto a partir deles e dos gauges de `info`.
const { criaMetricas } = require("../metricas");

test("render devolve texto Prometheus com content-type compatível (spec §4, spec §11 caso 10)", () => {
  const m = criaMetricas();
  m.resolve("hit"); m.resolve("hit"); m.resolve("erro");
  m.fonte("spc", "ok"); m.fonte("spc", "erro");
  m.resposta(812); m.resposta(188);
  const txt = m.render({ fontes: { total: 10, ativas: 9, em_cooldown: 1 },
                         cache: { positivo: 12, negativo: 3 } });
  assert.match(txt, /^gateway_up 1$/m);
  assert.match(txt, /^gateway_fontes_total 10$/m);
  assert.match(txt, /^gateway_fontes_ativas 9$/m);
  assert.match(txt, /^gateway_fontes_em_cooldown 1$/m);
  assert.match(txt, /^gateway_cache_entradas\{tipo="positivo"\} 12$/m);
  assert.match(txt, /^gateway_cache_entradas\{tipo="negativo"\} 3$/m);
  assert.match(txt, /^gateway_resolve_total\{cache="hit"\} 2$/m);
  assert.match(txt, /^gateway_resolve_total\{cache="miss"\} 0$/m);   // pré-semeado
  assert.match(txt, /^gateway_resolve_total\{cache="erro"\} 1$/m);
  assert.match(txt, /^gateway_fonte_total\{fonte="spc",resultado="ok"\} 1$/m);
  assert.match(txt, /^gateway_fonte_total\{fonte="spc",resultado="vazio"\} 0$/m); // pré-semeado
  assert.match(txt, /^gateway_resposta_ms_soma 1000$/m);
  assert.match(txt, /^gateway_resposta_ms_total 2$/m);
  assert.ok(!txt.includes("NaN"));
  assert.ok(txt.endsWith("\n"));                                  // termina com \n
});

test("rótulos saem em ordem estável para não gerar série nova a cada render", () => {
  const m = criaMetricas();
  m.resolve("miss");
  const info = { fontes: { total: 4, ativas: 3, em_cooldown: 1 },
                 cache: { positivo: 7, negativo: 2 } };
  const a = m.render(info), b = m.render(info);
  assert.equal(a, b);
});
