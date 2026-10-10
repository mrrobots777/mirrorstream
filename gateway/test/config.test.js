const test = require("node:test");
const assert = require("node:assert/strict");

// R1 — os defaults só valem sem PORT/MIRROR_ORCA_MS exportados. Zera a env
// antes do require e restaura o original no finally de cada caso; sem isso o
// teste falha por motivo alheio ao código em qualquer máquina com a env no CI.
const PORTA_ORIGINAL = process.env.PORT;
const ORCA_ORIGINAL = process.env.MIRROR_ORCA_MS;

function zeraPorta() { delete process.env.PORT; }
function zeraOrca() { delete process.env.MIRROR_ORCA_MS; }

function restauraPorta() {
  if (PORTA_ORIGINAL === undefined) delete process.env.PORT;
  else process.env.PORT = PORTA_ORIGINAL;
}
function restauraOrca() {
  if (ORCA_ORIGINAL === undefined) delete process.env.MIRROR_ORCA_MS;
  else process.env.MIRROR_ORCA_MS = ORCA_ORIGINAL;
}

zeraPorta();
zeraOrca();

const config = require("../config");

// PORTA/ORCA_MS são fixados no load do módulo; recarrega com a env vigente.
function recarregaConfig() {
  delete require.cache[require.resolve("../config")];
  return require("../config");
}

test("ORCA_MS cai em 6000 sem env e respeita os limites 1000-9000", () => {
  zeraOrca();
  try {
    assert.equal(recarregaConfig().ORCA_MS, 6000);           // sem MIRROR_ORCA_MS
  } finally {
    restauraOrca();
  }
});
test("PORTA cai em 7000 sem env", () => {
  zeraPorta();
  try {
    assert.equal(recarregaConfig().PORTA, 7000);
  } finally {
    restauraPorta();
  }
});
test("ORCA_MS é aparado em 9000 acima do teto e 1000 abaixo do piso (spec §5)", () => {
  try {
    process.env.MIRROR_ORCA_MS = "99999";
    assert.equal(recarregaConfig().ORCA_MS, 9000);
    process.env.MIRROR_ORCA_MS = "10";
    assert.equal(recarregaConfig().ORCA_MS, 1000);
  } finally {
    restauraOrca();
    recarregaConfig();                                      // devolve o cache ao estado sem env
  }
});
test("carregaEnv copia as chaves de segredo para globalThis", () => {
  process.env.TMDB_API_KEY = "chave-de-teste";
  config.carregaEnv();
  assert.equal(globalThis.TMDB_API_KEY, "chave-de-teste");
  delete process.env.TMDB_API_KEY;
  delete globalThis.TMDB_API_KEY;
});
test("sem MIRROR_EDGE_MODE o mediaWorkerDe continua ativo", () => {
  delete globalThis.MIRROR_EDGE_MODE;
  config.carregaEnv();
  const { edgeAtivo } = require("../../plugin/src/core/politica");
  assert.equal(edgeAtivo(), true);                          // sem isso a URL de mídia não é reescrita
});
