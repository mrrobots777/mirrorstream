// FONTES DE DORAMA — entradas cujo conteudo principal e' `dorama`
// (`conteudos[0] === "dorama"` => pasta `src/scrapers/doramas/`).
// Aqui mora SÓ a entrada; ordem, merge e API publica ficam em `index.js`.

module.exports = {
  dgo: {
    sigla: "DGO",
    arquivo: "doramogo.js",
    tipos: ["movie", "tv"],
    conteudos: ["dorama"],
    descricao: "Doramas via DGO (doramogo)"
  },
};
