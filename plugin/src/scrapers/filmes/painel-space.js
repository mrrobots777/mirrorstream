const { criaFonte } = require("../../lib/fonte-painel");

// Mesmos credenciais/defaults de `src/scrapers/xtream.js` no repo do Mirror (painel "Space").
// `node tools/publicacao/gerar-indice.js` compara este bloco com o do addon e falha alto se divergirem.
const PAINEL = {
  sigla: "SPC",
  idx: "spc",
  servidor: "telaplay93.top",
  porta: "80",
  // SEM DEFAULT AQUI, de proposito — o valor que vivia embutido ficou publico no
  // GitHub (o repo e' PUBLICO). A credencial agora vive so' no ambiente do
  // gateway (`beamup secrets MIRROR_SPC_USER/PASS` -> `carregaEnv()`).
  get usuario() { return globalThis.MIRROR_SPC_USER; },
  get senha() { return globalThis.MIRROR_SPC_PASS; }
};

module.exports.getStreams = criaFonte(PAINEL, { catalogo: false });
