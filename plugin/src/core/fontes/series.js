// FONTES DE SÉRIE — entradas cujo conteudo principal e' `serie`
// (`conteudos[0] === "serie"` => pasta `src/scrapers/series/`).
//
// VAZIO DE PROPOSITO (spec §7.5): nenhuma fonte tem `serie` como conteudo
// principal — as fontes de serie (spt, blz, spc, ato, vzr, rtd) todas ABREM com
// `filme` e vivem em `filmes/` ou `animes/`. A pasta `series/` fica visivel para
// a proxima fonte e `test/categorias.test.js` aceita o registro vazio: nao e' erro.

module.exports = {};
