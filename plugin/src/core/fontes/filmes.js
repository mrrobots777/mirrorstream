// FONTES DE FILME — entradas cujo conteudo principal e' `filme`
// (`conteudos[0] === "filme"` => pasta `src/scrapers/filmes/`).
// Aqui mora SÓ a entrada; ordem, merge e API publica ficam em `index.js`.

module.exports = {
  blz: {
    sigla: "BLZ",
    arquivo: "painel-blaze.js",
    tipos: ["movie", "tv"],
    conteudos: ["filme", "serie"],
    descricao: "Filmes e séries via BLZ (kakito)",
    idx: "blz"
  },
  spc: {
    sigla: "SPC",
    arquivo: "painel-space.js",
    tipos: ["movie", "tv"],
    conteudos: ["filme", "serie"],
    descricao: "Filmes e séries via SPC (telaplay)",
    idx: "spc"
  },
  ato: {
    sigla: "ATO",
    arquivo: "painel-autos.js",
    tipos: ["movie", "tv"],
    conteudos: ["filme", "serie"],
    descricao: "Filmes e séries via ATO (painel Xtream)",
    idx: "ato",
    ativo: false,
    motivo: "desativada: painel firetvcb.net responde a pagina default do nginx (235 B, text/html) nas duas acoes e nos dois protocolos, medido 08/10/2026 — sem player_api.php nao ha catalogo, e sem catalogo nao ha shard de /idx/ato/, que e o unico caminho desta fonte (catalogo: false)"
  },
};