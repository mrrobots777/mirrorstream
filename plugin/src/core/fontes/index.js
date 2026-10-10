// REGISTRO DAS FONTES DO PLUGIN — o índice do diretório `src/core/fontes/`.
//
// Toda fonte se declara UMA VEZ, no arquivo da SUA categoria (`animes.js`,
// `filmes.js`, `series.js`, `doramas.js`). Este arquivo faz o merge e mantém a
// API pública idêntica à do antigo `fontes.js` de arquivo único — quem faz
// `require("./src/core/fontes")` continua enxergando o mesmo objeto. O resto do
// plugin deriva:
//   * `build.js` gera o `manifest.json` do repositório a partir daqui
//     (o manifesto virou saída de build — não existe mais escrito à mão);
//   * `teste.js` acha o arquivo da fonte por `arquivo`;
//   * `tools/publicacao/gerar-indice.js` lê a credencial do painel em `arquivo`;
//   * este diretório não é bundlado em nenhum scraper: quem precisa dele é o
//     tooling (Node), nunca o runtime do Nuvio.
//
// Campos:
//   chave      identificador do scraper no repositório do Nuvio ("blz")
//   sigla      o nome curto que aparece na lista de fontes do app ("BLZ")
//   arquivo    módulo do scraper em `src/scrapers/` (kebab-case)
//   tipos      `supportedTypes` do manifesto ("movie" = filme, "tv" = série)
//   conteudos  o que a fonte ENTREGA (categoria de conteúdo)
//   descricao  uma linha do manifesto, que o dono lê na tela de Plugins
//   idx        namespace do shard em `public/idx/` (só painéis com índice)
//
// Para mudar qualquer nome, arquivo ou tipo: muda NO ARQUIVO DA CATEGORIA e só
// lá.

const GRUPOS = {
  vod: "CDN VOD",
};

const CONTEUDOS = ["anime", "filme", "serie", "dorama"];

// A PASTA DA CATEGORIA em `src/scrapers/`. Derivada da categoria principal
// (`conteudos[0]`) — mesma regra que `test/categorias.test.js` trava. Um valor
// fora daqui nao monta caminho: `diretorioDe` devolveria `undefined`.
const PLURAL = { anime: "animes", filme: "filmes", serie: "series", dorama: "doramas" };

// A ORDEM DE DECLARAÇÃO de hoje — a ordem do registro único de arquivo único,
// copiada à mão. `chavesTodos()` é derivada DESTE array, não do merge: os
// arquivos de categoria reagrupam as chaves por pasta (animes, filmes, series,
// doramas), e a ordem de `chavesTodos()` é a ordem do array `scrapers` do
// manifesto — conteúdo PUBLICADO byte a byte. Sem esta lista o manifesto
// reordenaria e `public/manifest.json` mudaria sem ninguém pedir.
// Toda chave dos 4 arquivos de categoria precisa estar aqui (e vice-versa).
const ORDEM = [
  "shg", "ron", "atb",
  "blz", "spc", "ato",
  "ise", "san", "rtd",
  "dgo",
];

// O REGISTRO COMPLETO: merge dos 4 arquivos de categoria, na ordem
// `animes, filmes, series, doramas`. A ordem das CHAVES deste objeto não
// importa para o manifesto — quem manda é `ORDEM` — mas cada entrada é única:
// uma chave repetida em dois arquivos seria sobrescrita em silêncio.
const FONTES = {
  ...require("./animes"),
  ...require("./filmes"),
  ...require("./series"),
  ...require("./doramas"),
};

function rotuloDe(grupo, sigla) {
  return `${GRUPOS[grupo]} | ${sigla}`;
}

const NOME_REPOSITORIO = "MirrorStream";
const VERSAO_REPOSITORIO = "1.0.5";
const VERSAO_SCRAPER = "1.0.5";
// A DESCRICAO vem DEPOIS de `const FONTES`: `chaves()` faz hoisting, mas `FONTES`
// e' `const` — declarar antes estouraria `Cannot access 'FONTES' before
// initialization`. A contagem e' derivada de `chaves().length` (fontes ativas),
// nunca digitada: ligar/desligar uma fonte nao deixa a frase desatualizada.
const DESCRICAO_REPOSITORIO =
  `MirrorStream — ${chaves().length} fontes VOD ativas de anime, filme, série e dorama para o Nuvio`;

function fonte(chave) {
  const f = FONTES[chave];
  if (!f) throw new Error(`fonte fora do registro (src/core/fontes/): ${chave}`);
  return f;
}

function chavesTodos() {
  return ORDEM.slice();
}
function chaves() {
  return chavesTodos().filter(chave => FONTES[chave].ativo !== false);
}

function fontesDe(conteudo) {
  return chaves().filter(chave => FONTES[chave].conteudos.includes(conteudo));
}

// `idx` e' o PREFIXO do shard que a fonte le do mesmo endereco do manifesto. Quem tem `idx`
// precisa que o prefixo exista publicado; quem nao tem, consulta a API dela.
//
// Duas listas, e a diferenca e' o que separava "fonte que tem shard" de "fonte que o
// `tools/publicacao/gerar-indice.js` consegue construir":
//
// MEDIDO 08/10/2026: o RTD tem `idx: "rtd"` (prefixo valido, o scraper le `/idx/rtd/`) mas
// nao tem indice de PAINEL — o catalogo dele vem da API `/api/catalog-index`. O gerador,
// que so sabe chamar `player_api.php` de painel Xtream, recebia o RTD na lista, montava
// `https://:/player_api.php?...` (sem `servidor`/`usuario`/`senha`) e derrubava o deploy
// inteiro. No app nada disso aparecia: a fonte funciona pela API dela. O que faltava era a
// lista certa, e `painel: false` no registro e' o que a declara.
function fontesComIndice() {
  return chaves().filter(chave => !!FONTES[chave].idx);
}

// As fontes cujo shard o `tools/publicacao/gerar-indice.js` consegue construir: as de painel
// Xtream. O RTD (API propria) fica de fora por definicao, e nao por acidente.
function fontesDePainel() {
  return chaves().filter(chave => !!FONTES[chave].idx && FONTES[chave].painel !== false);
}

function arquivoDe(chave) {
  return fonte(chave).arquivo;
}

// O CAMINHO DE CADA SCRAPER e' derivado, nunca reconstruido por quem chama:
// `src/scrapers/<plural(conteudos[0])>/<arquivo>`, separador `/`, relativo a
// `plugin/`. String simples — este arquivo roda tambem no tooling Node, mas o
// caminho vira `path.join(raiz, …)` so' no chamador; aqui nao ha `fs`.
function diretorioDe(chave) {
  return PLURAL[fonte(chave).conteudos[0]];
}

function caminhoDe(chave) {
  return `src/scrapers/${diretorioDe(chave)}/${arquivoDe(chave)}`;
}

// AS CHAVES AGRUPADAS POR CATEGORIA: o mesmo conteúdo de `chavesTodos()`
// (inclusive as desativadas), na mesma ordem, agrupadas pelo diretório da
// categoria. `series` vem sempre — vazio é válido (spec §7.5).
function porCategoria() {
  const grupos = { animes: [], filmes: [], series: [], doramas: [] };
  for (const chave of chavesTodos()) {
    grupos[diretorioDe(chave)].push(chave);
  }
  return grupos;
}

function bundleDe(chave) {
  return `${chave}.js`;
}

function grupo(chave) {
  return "vod";
}

function rotulo(chave) {
  return rotuloDe(grupo(chave), sigla(chave));
}

function sigla(chave) {
  const f = FONTES[chave];
  return f ? f.sigla : String(chave || "").toUpperCase();
}

function prefixo(chave) {
  const f = FONTES[chave];
  return f && f.prefixo !== undefined ? f.prefixo : `${chave}:`;
}

function conteudo(chave) {
  return FONTES[chave].conteudos.join(", ");
}

function scrapers() {
  return chaves().map(chave => {
    const f = FONTES[chave];
    return {
      id: chave,
      name: f.sigla,
      version: VERSAO_SCRAPER,
      filename: bundleDe(chave),
      description: f.descricao,
      supportedTypes: f.tipos.slice()
    };
  });
}

function scraperAgregado() {
  return {
    id: "mirrorstream",
    name: "MirrorStream",
    version: VERSAO_SCRAPER,
    filename: "mirrorstream.js",
    description: "Filmes, séries, animes e doramas — um player por qualidade",
    supportedTypes: ["movie", "tv"]
  };
}

function manifesto() {
  return {
    name: NOME_REPOSITORIO,
    version: VERSAO_REPOSITORIO,
    description: DESCRICAO_REPOSITORIO,
    author: NOME_REPOSITORIO,
    scrapers: [scraperAgregado()]
  };
}

module.exports = {
  CONTEUDOS,
  DESCRICAO_REPOSITORIO,
  FONTES,
  GRUPOS,
  NOME_REPOSITORIO,
  VERSAO_REPOSITORIO,
  VERSAO_SCRAPER,
  arquivoDe,
  bundleDe,
  caminhoDe,
  chaves,
  chavesTodos,
  conteudo,
  diretorioDe,
  fonte,
  fontesComIndice,
  fontesDePainel,
  fontesDe,
  grupo,
  manifesto,
  porCategoria,
  prefixo,
  rotulo,
  scrapers,
  sigla
};
