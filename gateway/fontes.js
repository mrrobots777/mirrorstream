"use strict";

// Camada de fontes do gateway: carrega os scrapers do registro do plugin na
// subida e responde quem é elegível para um tipo. Só roda em Node — spec §8.
//
// Este módulo NÃO executa scraper algum: `carrega()` só faz `require` de cada
// arquivo (spec §14 — scraper escrito para o aparelho pode estourar API de
// navegador no Node, e a subida precisa sobreviver a isso), e `elegiveis()`
// devolve quem pode atender "movie" ou "tv". A execução em si é Task 6.
const path = require("node:path");

// R9 — o registro importa com outro nome: este módulo exporta `chaves` e
// `tiposDe` (pass-through do registro), e um import chamado `fontes` apontaria
// os pass-through para o próprio módulo.
const registro = require(path.join(__dirname, "..", "plugin", "src", "core", "fontes"));

// Raiz do repositório. `registro.caminhoDe(chave)` devolve caminho relativo a
// `plugin/` ("src/scrapers/filmes/blz.js") — o require do scraper é isto sob
// `path.join(raizRepo, "plugin", …)`.
const raizRepo = path.join(__dirname, "..");

// As entradas carregadas, mantidas na ordem de `registro.chaves()` (que é a
// ordem `ORDEM` do registro, só com as ativas). `elegiveis()` percorre
// `chaves()` e lê daqui, então a ordem de saída é a ordem do registro.
const carregadas = new Map();
let falhasDaCarga = [];
let jaCarregou = false;

// Boot: carrega UMA vez cada fonte ativa. Fonte que falhar vira entrada em
// `falhas` e as demais continuam — um scraper quebrado não derruba a subida
// (spec §14). Segunda chamada é idempotente: nem re-require, nem re-conta.
function carrega() {
  if (!jaCarregou) {
    falhasDaCarga = [];
    for (const chave of registro.chaves()) {
      try {
        const scraper = require(path.join(raizRepo, "plugin", registro.caminhoDe(chave)));
        carregadas.set(chave, { chave, getStreams: scraper.getStreams });
      } catch (e) {
        falhasDaCarga.push({ chave, erro: String((e && e.message) || e) });
      }
    }
    jaCarregou = true;
  }
  return { total: total(), ativas: carregadas.size, falhas: falhasDaCarga };
}

// Quem atende `tipo`: as carregadas, em ordem de registro, cujo `tipos` da
// entrada inclui o tipo (lista vazia contém tudo — a regra do próprio
// registro). Fonte que falhou no boot não elegge (não está em `carregadas`).
function elegiveis(tipo) {
  const resposta = [];
  for (const chave of registro.chaves()) {
    const entrada = carregadas.get(chave);
    if (!entrada) continue;
    const tipos = registro.fonte(chave).tipos;
    if (!tipos.length || tipos.includes(tipo)) resposta.push(entrada);
  }
  return resposta;
}

// Total é o do registro (ativas, inclui a que viria a falhar no boot) e existe
// antes do `carrega()`; `ativas()` é o que de fato subiu — 0 antes do boot.
function total() {
  return registro.chaves().length;
}

function ativas() {
  return carregadas.size;
}

// Pass-throughs finos: o teste de boot usa estes em vez de importar o
// registro do plugin direto.
function chaves() {
  return registro.chaves();
}

function tiposDe(chave) {
  return registro.fonte(chave).tipos;
}

module.exports = { ativas, carrega, chaves, elegiveis, total, tiposDe };
