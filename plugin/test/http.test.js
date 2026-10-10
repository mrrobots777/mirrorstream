"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { pegarJson } = require("../src/lib/http");

test("http repete uma falha transitória sem exigir worker", async () => {
  const anterior = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => {
    chamadas += 1;
    if (chamadas === 1) throw new Error("fetch failed");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const resposta = await pegarJson("https://example.invalid/data", { ms: 500 });
    assert.deepEqual(resposta.dados, { ok: true });
    assert.equal(chamadas, 2);
  } finally {
    globalThis.fetch = anterior;
  }
});

test("http preserva status e trata JSON inválido em resposta de erro", async () => {
  const anterior = globalThis.fetch;
  globalThis.fetch = async () => new Response("não-json", { status: 503 });
  try {
    const resposta = await pegarJson("https://example.invalid/error", { ms: 500 });
    assert.equal(resposta.ok, false);
    assert.equal(resposta.status, 503);
    assert.equal(resposta.dados, null);
  } finally {
    globalThis.fetch = anterior;
  }
});
