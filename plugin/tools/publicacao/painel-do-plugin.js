"use strict";

// Onde o gerador de shards (`gerar-indice.js`) descobre a credencial de cada
// painel. Ficou fora do script porque o script é uma IIFE — não dá para
// importar sem rodar o gerador inteiro, e testar isso é justamente o que
// faltava aqui (ver o histórico em `paineisDoAddon`).
//
// MEDIDO 10/10/2026: o `publicar-pages` FALHOU no commit que tirou as
// credenciais do código. O log dizia
// `[indice] ALERTA blz sem shard: Cannot read properties of undefined (reading 'porta')`
// e `[indice] erro: nenhuma fonte gerou shard`. A causa: o gerador_prefixo
// lia a credencial do TEXTO do scraper, e o scraper parou de tê-la — o
// `campoDe` batia com a regex do `|| "literal"` e vinha vazio. Sem credencial
// não há `player_api.php`, e sem `player_api.php` não há shard.
//
// A credencial agora vem do AMBIENTE (no CI, de `secrets`), que é o mesmo
// lugar de onde o gateway a pega. O parse do código continua como último
// caso — para um scraper que ainda tenha default, o comportamento é o de antes.

const fs = require("node:fs");
const path = require("node:path");

function campoDe(bloco, nome) {
  const re = new RegExp(`(?:${nome}\\s*:\\s*|get\\s+${nome}\\s*\\(\\)\\s*\\{\\s*return\\s+globalThis\\.[A-Z0-9_]+\\s*\\|\\|\\s*)"([^"]*)"`);
  const m = bloco.match(re);
  return m ? m[1] : "";
}

// Ambiente primeiro. O nome da variável é o MESMO que `gateway/config.js` lê
// (`MIRROR_<CHAVE>_USER` / `MIRROR_<CHAVE>_PASS`), então quem configura uma vez
// configura para os dois lados.
function credencialDe(txt, nome, chave, sufixo) {
  const variavel = `MIRROR_${chave.toUpperCase()}_${sufixo}`;
  const doAmbiente = process.env[variavel];
  if (typeof doAmbiente === "string" && doAmbiente.trim()) return doAmbiente.trim();
  return campoDe(txt, nome);
}

function painelDoPlugin(raiz, caminhoDe, chave) {
  const arquivo = path.join(raiz, caminhoDe(chave));
  if (!fs.existsSync(arquivo)) return null;
  const txt = fs.readFileSync(arquivo, "utf8");
  return {
    sigla: campoDe(txt, "sigla"),
    idx: campoDe(txt, "idx"),
    servidor: campoDe(txt, "servidor"),
    porta: campoDe(txt, "porta"),
    usuario: credencialDe(txt, "usuario", chave, "USER"),
    senha: credencialDe(txt, "senha", chave, "PASS")
  };
}

module.exports = { painelDoPlugin, campoDe, credencialDe };
