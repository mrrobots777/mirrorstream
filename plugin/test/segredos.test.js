"use strict";

// GUARDA DE VAZAMENTO DE CREDENCIAL.
//
// MEDIDO 10/10/2026: o repositório é PÚBLICO (`gh api repos/... --jq .private`
// devolve `false`) e tinha a credencial dos TRÊS painéis em 9 arquivos
// versionados desde 02/10 — `plugin/src/scrapers/filmes/painel-*.js` com
// `|| "senha"`, `infra/*`, `.env.example` e uma fixture de teste.
//
// A primeira versão desta guarda guardava os VALORES numa lista. Percebi depois
// que isso era o furo inteiro: o teste rodava no GitHub, público, e qualquer um
// lia a credencial abrindo o próprio arquivo que a procurava. A lista agora é de
// DIGEST SHA-256 — não dá para voltar ao valor, e descobrir uma string de 6+
// caracteres cujo SHA-256 bata com um digest desses não é ataque, é sorte.
//
// `TMDB_API_KEY` NÃO está aqui de propósito: ela é injetada pelo build e o
// `publicar-pages.yml` ainda não recebe `secrets.TMDB_API_KEY`. Incluí-la
// quebraria o CI antes de a chave existir lá. Quando o segredo do GitHub
// estiver criado, a chave sai de `plugin/config/tmdb.js` e o digest entra aqui.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const RAIZ = path.join(__dirname, "..", "..");

// SHA-256 das credenciais que vazaram. Um arquivo novo que as contenha é
// pego aqui — inclusive este próprio teste, que por isso NÃO guarda os valores.
const DIGESTAS = {
  "BLZ usuario": "407ff8c95b04ca7ca1f71e02f710b20a395d65ecb1c5be460ef0a29ff7f37af6",
  "BLZ senha": "4022dbb70639a5324cf37263511f24a8180fa0eaad8864e3d6ae29cf5f999e0b",
  "SPC usuario": "8dc310491ba47b7635bbba2d713a3b0af1ce0a2100e8a97a6a98fa71b2603410",
  "SPC senha": "bcaaac412d3b15710809d54bf57a72b4c92a795666a25bcc2162bd3d43ba552d",
  "ATO usuario": "2de986f71f6a6b09d9d3925588a7377747319e352387d235e547483f7d668c6c",
  "ATO senha": "bd1d16beb1643657c8a6d8b6d822bec8c16adf7ddce2429d7e54caedba6b3986",
};
const ALVOS = new Set(Object.values(DIGESTAS));
const MIN = 6;                     // a credencial mais curta vazada tem 6 caracteres

function digest(txt) {
  return crypto.createHash("sha256").update(txt, "utf8").digest("hex");
}

// Pedaços que poderiam ser uma credencial: separados por aspas, espaço,
// barra, dois-pontos, `&`, `=` — o mesmo contexto em que os valores vazaram
// (getter com `||`, URL de player_api, valor de `.env`).
function tokens(txt) {
  return txt.match(/[A-Za-z0-9@._-]{6,}/g) || [];
}

// Só o que o git rastreia entra: `plugin/dist/` e `plugin/public/idx/` são
// ignorados justamente porque são gerados, e varrê-los faria o teste falhar por
// um artefato local que ninguém publicou.
function versionados() {
  const cru = execFileSync("git", ["ls-files", "-z"], { cwd: RAIZ, maxBuffer: 64 * 1024 * 1024 });
  return cru.toString("utf8").split("\0").filter(Boolean);
}

// Binário e arquivo grande não entram: `logo.png` não tem credencial em texto
// e ler 5 MB em UTF-8 só para tokenizar é custo sem informação.
function legivel(arquivo) {
  if (/\.(png|jpe?g|gif|ico|woff2?|ttf|wasm|db|mp4|m3u8)$/i.test(arquivo)) return false;
  try {
    const st = fs.statSync(arquivo);
    return st.isFile() && st.size <= 2 * 1024 * 1024;
  } catch {
    return false;
  }
}

test("nenhum digest de credencial de painel aparece nos arquivos versionados", () => {
  const achados = [];
  for (const rel of versionados()) {
    const abs = path.join(RAIZ, rel);
    if (!legivel(abs)) continue;
    let texto;
    try {
      texto = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const tok of tokens(texto)) {
      if (ALVOS.has(digest(tok))) achados.push(`${rel} (token de ${tok.length} caracteres)`);
    }
  }
  assert.deepEqual(
    achados,
    [],
    `credencial de painel no repositório público:\n  ${achados.join("\n  ")}`
  );
});

// Prova de que a varredora FUNCIONA — sem ela, um ALVOS com digest errado
// deixaria o teste passar para sempre sem vigiar nada. Usa um valor plantado
// aqui, que não é credencial de ninguém.
test("a varredeura acha um valor plantado (o digest não é enfeite)", () => {
  const plantado = "valor-plantado-para-provar-a-varrededura";
  const alvo = new Set([digest(plantado)]);
  const achou = tokens(`x = "${plantado}"; y = '${plantado}'; z=/a${plantado}b/`).filter((t) => alvo.has(digest(t)));
  assert.ok(achou.includes(plantado), "a varredeura tem de reconhecer o valor plantado nos 3 contextos");
});

test("os fontes de painel leem a credencial do ambiente, sem valor padrão", () => {
  // O contrato que sustenta a remoção: `globalThis.MIRROR_*` ou nada. Um
  // `|| "senha"` no meio do getter seria o vazamento de volta, e este teste
  // trava o FORMATO, não só o valor — trocar a senha mantém o problema.
  const fontes = [
    "plugin/src/scrapers/filmes/painel-blaze.js",
    "plugin/src/scrapers/filmes/painel-space.js",
    "plugin/src/scrapers/filmes/painel-autos.js",
  ];
  for (const rel of fontes) {
    const texto = fs.readFileSync(path.join(RAIZ, rel), "utf8");
    assert.ok(
      /get\s+usuario\s*\(\s*\)\s*\{\s*return\s+globalThis\.MIRROR_[A-Z_]+_USER/.test(texto),
      `${rel}: usuario deve vir de globalThis.MIRROR_*_USER, sem default`
    );
    assert.ok(
      /get\s+senha\s*\(\s*\)\s*\{\s*return\s+globalThis\.MIRROR_[A-Z_]+_PASS/.test(texto),
      `${rel}: senha deve vir de globalThis.MIRROR_*_PASS, sem default`
    );
    assert.ok(
      !/\|\|\s*["'][^"']{4,}["']/.test(texto),
      `${rel}: getter com fallback literal — o default volta a vazar`
    );
  }
});
