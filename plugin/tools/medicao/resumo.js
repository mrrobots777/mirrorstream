// O RESUMO POR CATEGORIA DAS MEDICOES.
//
// As medicoes falavam por fonte: uma linha por fonte e uma linha de total. Com os scrapers
// separados em `animes/`, `filmes/`, `series/` e `doramas/`, a pergunta que o time faz nao e'
// "a fonte `dgo` respondeu?" — e' "anime esta de pe?". O agregado responde a segunda sem
// perder a primeira: `bateria.js` e `monitorar-fontes.js` continuam imprimindo fonte a fonte
// e acrescentam esta linha.
//
// As duas funcoes sao PURAS e recebem `diretorioDe` por parametro. Isso e' o que as torna
// testaveis sem rede e sem carregar o registro — e o que permite ao teste injetar uma
// categoria invalida para ver o erro (ver `test/agregador.test.js`).
//
// `CATEGORIAS` e' a lista fixa, repetida do registro de proposito: se um dia o registro
// ganhar uma quinta categoria, o teste que compara as duas listas avisa, em vez deste
// resumo ficar quietamente para tras.

const CATEGORIAS = ["animes", "filmes", "series", "doramas"];

// `itens`: `[{ chave, ok }]`, onde `ok` ja e' o veredito da medicao (`status === "ok"`, ou
// "entregou stream vivo"). `diretorioDe`: `chave -> categoria`.
//
// Devolve UM item por categoria, sempre as quatro, na ordem de `CATEGORIAS` — inclusive as
// que nao item nada. Uma categoria ausente do resumo seria lida como "esquecida", e nao como
// "nenhuma fonte".
function agrupaPorCategoria(itens, diretorioDe) {
  const contagem = new Map(CATEGORIAS.map(c => [c, { categoria: c, total: 0, ok: 0 }]));
  for (const item of itens) {
    const categoria = diretorioDe(item.chave);
    const alvo = contagem.get(categoria);
    if (!alvo) {
      throw new Error(
        `categoria "${categoria}" da fonte ${item.chave} nao existe — esperadas: ${CATEGORIAS.join(", ")}`
      );
    }
    alvo.total += 1;
    if (item.ok) alvo.ok += 1;
  }
  return CATEGORIAS.map(c => contagem.get(c));
}

// "animes 2/2 | filmes 1/1 | series 0/0 | doramas 0/1" — uma linha, cabendo no terminal.
function linhaPorCategoria(grupos) {
  return grupos.map(g => `${g.categoria} ${g.ok}/${g.total}`).join(" | ");
}

module.exports = { CATEGORIAS, agrupaPorCategoria, linhaPorCategoria };