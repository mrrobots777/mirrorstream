// MEDIDO 02/10/2026: o id que o Nuvio entrega ao plugin.
//
// O dono: *"nao e' para ter catalogo, o addon e' chamado quando o usuario entra em um vod do
// cinameta ai as fontes sao buscadas via imdb"*. Entao o id que chega em `getStreams` e' o do
// **Cinemeta**, que e' IMDb (`tt0133093`), e nao TMDB.
//
// MEDIDO, o estrago: as 7 fontes de VOD passam por um `idDe()` que faz
// `valor.replace(/[^0-9]/g, "")`. Para `tt0133093` isso da `0133093` — que no TMDB e' o filme
// **"Strings" (2012)**, nao "The Matrix". A fonte buscava as fontes do filme errado, nao casava
// com nada e devolvia `[]` **sem erro nenhum** — o que o Nuvio le como "nenhuma fonte".
// O log do BLZ dizia o defeito inteiro numa linha:
//
//     [BLZ] 1584 item(s) lidos, nenhum casa com "Strings" — [] de proposito
//
// Antes: SPT/VZR/RTD/BLZ/SPC devolviam 0 para `tt0133093` e 1+ para `603`.
// Este arquivo trava essa classe de defeito no codigo, sem rede.

const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = require("node:path").join(__dirname, "..");
const { idDe, pareceImdb, pareceTmdb } = require("../src/lib/id-de-conteudo");

// Os scrapers vivem em `src/scrapers/<categoria>/` (reorganizacao por categoria,
// spec §7): qualquer varredura deles e' RECURSIVA, ou enxerga zero arquivo e
// passa no vazio — o pior tipo de verde.
function varrerScrapers() {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(ROOT, "src", "scrapers");
  const saida = [];
  const anda = (atual) => {
    for (const nome of fs.readdirSync(atual)) {
      const p = path.join(atual, nome);
      if (fs.statSync(p).isDirectory()) anda(p);
      else if (nome.endsWith(".js")) saida.push(p);
    }
  };
  anda(dir);
  return saida;
}

test("o id do Cinemeta (IMDb) nao pode virar um id de TMDB pela troca de digitos", () => {
  // tt0133093 = The Matrix no IMDb. O TMDB dele e' 603.
  // O defeito: `replace(/[^0-9]/g,"")` dava "0133093", que o TMDB resolve como "Strings" (2012).
  assert.equal(idDe("tt0133093"), null, "IMDb nao pode ser normalizado por digito: viraria outro filme");
  assert.equal(idDe("tt0903747"), null);
});

test("idDe so aceita id de TMDB, nas duas formas que o app envia", () => {
  assert.equal(idDe("603"), "603");
  assert.equal(idDe("tmdb:603"), "603");
  assert.equal(idDe("  603  "), "603");
  assert.equal(idDe(603), "603");
});

test("o id de serie perde o sufixo de temporada/episodio e NAO ganha digito a mais", () => {
  // MEDIDO: `tt0903747:1:1` virava "090374711" e o TMDB devolvia 404 nas duas rotas
  // (/movie/ e /tv/). Com o id certo, sobra "1396".
  assert.equal(idDe("603:1:1"), "603");
  assert.equal(idDe("tt0903747:1:1"), null, "IMDb de serie tambem nao pode virar TMDB");
});

test("idDe rejeita o que nao e' id, em vez de devolver lixo numerico", () => {
  assert.equal(idDe(""), null);
  assert.equal(idDe(null), null);
  assert.equal(idDe(undefined), null);
  assert.equal(idDe("tmdb:"), null);
  assert.equal(idDe("kitsu:12345"), null, "kitsu: nao e' TMDB — deixar passar seria chamar a fonte errada");
  assert.equal(idDe("abc"), null);
});

test("pareceImdb e pareceTmdb separam os dois mundos sem confundi-los", () => {
  assert.equal(pareceImdb("tt0133093"), true);
  assert.equal(pareceImdb("tt0133093:1:1"), true, "o id de serie do Cinemeta vem com o sufixo");
  assert.equal(pareceImdb("603"), false);
  assert.equal(pareceImdb("tmdb:603"), false);

  assert.equal(pareceTmdb("603"), true);
  assert.equal(pareceTmdb("tmdb:603"), true);
  assert.equal(pareceTmdb("tt0133093"), false);
});

// Este teste e' o segundo defeito da MESMA correcao, e ele so apareceu porque o e2e rodou um
// dorama: `tt13274038` ("Beleza Verdadeira") tem **8** digitos, e o regex que eu escrevi
// (`tt\d{7}`) aceitava so 7. Resultado: `pareceImdb` false -> nenhuma chamada ao TMDB ->
// `tmdbIdDe` devolve `null` em ~2 ms, sem rede, sem erro. A fonte devolvia `[]` e o sintoma
// era o MESMO do defeito original ("nenhuma fonte"), com outra causa.
//
// E' por isso que o "7 digitos" nao pode ser um numero no codigo: o IMDb nao promete 7. A
// forma do id e' `tt` + digitos, e o limite real e o do `int` que o IMDb usa (10 digitos).
test("o id do IMDb nao tem um numero fixo de digitos", () => {
  assert.equal(pareceImdb("tt13274038"), true, "8 digitos: Beleza Verdadeira, que e' o id que quebrou");
  assert.equal(pareceImdb("tt5994364"), true);
  // E o outro lado: um id de TMDB nunca comeca com `tt`.
  assert.equal(idDe("tt13274038"), null, "mesmo com 8 digitos, continua nao sendo TMDB");
  // Fronteiras: 7 e 10 digitos (o maximo que o IMDb emite).
  assert.equal(pareceImdb("tt1234567"), true);
  assert.equal(pareceImdb("tt1234567890"), true);
  // E o que NAO e' id IMDb.
  assert.equal(pareceImdb("tt123456"), false, "6 digitos: curto demais para ser id de titulo");
  assert.equal(pareceImdb("tt12345678901"), false, "11 digitos: alem do que o IMDb emite");
  assert.equal(pareceImdb("ttabcdefg"), false);
  assert.equal(pareceImdb("mirror:123"), false);
});

// ── A trava que impede o defeito de voltar: NENHUMA fonte pode normalizar id por digito ──
//
// `replace(/[^0-9]/g, "")` num id que comeca com `tt` e' a ASSINATURA do defeito. Sem esta
// trava, uma fonte nova (ou um "ajuste" num arquivo antigo) reintroduz o `[]` silencioso e o
// dono ve "nenhuma fonte" sem nenhuma pista — que e' exatamente o relato desta rodada.
test("nenhuma fonte normaliza id de conteudo trocando tudo que nao e' digito", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const culpados = [];
  for (const p of varrerScrapers()) {
    const txt = fs.readFileSync(p, "utf8");
    // O padrao e' procurado em CODIGO, nunca em comentario: o comentario que documenta
    // o defeito ("o `replace(/[^0-9]/g, "")` de antes") tem a MESMA string do codigo, e
    // um verificador que acusa o proprio comentario impede de explicar a correcao.
    // Regra: uma linha de comentario (`//`, `*`, `/*`) nunca conta.
    const codigo = txt
      .split("\n")
      .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
      .join("\n");
    if (/\[\^0-9\]\/g,\s*""/.test(codigo)) {
      culpados.push(path.relative(ROOT, p).split(path.sep).join("/"));
    }
  }
  assert.deepEqual(
    culpados,
    [],
    `fontes que convertem id por digito (tt0133093 -> 0133093 = "Strings"): ${culpados.join(", ")}. ` +
      `Todo id passa por src/lib/id-de-conteudo.js.`
  );
});

// ── A CAMADA DE CIMA: o id IMDb precisa CHEGAR virado, nao recusado ──
//
// O `idDe` acima impede o pior (buscar "Strings" quando o usuario abriu "The Matrix"), mas
// sozinho ele entrega `[]` para todo o caminho real do dono — que e' abrir um vod do
// Cinemeta. Estas travas cobrem o que o dono mediu: o id que o app entrega e' `tt…`, e uma
// fonte que devolve `[]` para ele nao tem fonte nenhuma no caminho que importa.
//
// Nao ha rede aqui: quem resolve e' `src/lib/tmdb.js`, e o contrato testado e' que o id IMDb
// **passa por ela** e vira id de TMDB antes de qualquer consulta a fonte.
test("o tmdb.js do plugin resolve id IMDb para id de TMDB (o caminho do dono)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const txt = fs.readFileSync(path.join(ROOT, "src", "lib", "tmdb.js"), "utf8");
  assert.match(
    txt,
    /find\/|external_source=imdb_id/,
    "src/lib/tmdb.js nao resolve IMDb -> TMDB; sem isso o id do Cinemeta nao vira titulo"
  );
});

test("toda fonte de VOD resolve o id por tmdb.js OU pelo caminho da fonte-painel", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const semResolucao = [];
  // Dois niveis: o scraper esta em `src/scrapers/<categoria>/`, entao o modulo
  // comum e' `../../lib/…`.
  for (const p of varrerScrapers()) {
    const txt = fs.readFileSync(p, "utf8");
    const viaTmdb = /require\("\.\.\/\.\.\/lib\/tmdb"\)/.test(txt);
    const viaId = /require\("\.\.\/\.\.\/lib\/id-de-conteudo"\)/.test(txt);
    // As 3 de PAINEL (blz/spc/ato) nao precisam de import proprio: elas sao fine wrappers de
    // `criaFonte()` em `src/lib/fonte-painel.js`, que e' quem resolve o id — e e' o mesmo
    // lugar que BLZ/SPC/ATO compartilham. Um import aqui seria teatro: o id nao passa por
    // este arquivo. O que trava e' o teste do `fonte-painel`, logo abaixo.
    const ePainel = /require\("\.\.\/\.\.\/lib\/fonte-painel"\)/.test(txt);
    if (!viaTmdb && !viaId && !ePainel) {
      semResolucao.push(path.relative(ROOT, p).split(path.sep).join("/"));
    }
  }
  assert.deepEqual(
    semResolucao,
    [],
    `fontes sem caminho de resolucao de id: ${semResolucao.join(", ")}`
  );
});

// Este teste existe porque a PRIMEIRA versao da correcao trocou o `?` por `&` e todas as 6
// fontes passaram a lancar `TMDB 401 em /find/tt0133093` — a URL ficou
// `…/3/find/tt0133093&api_key=…`, sem `?`. Nenhum teste de id pegaria isso: ele passa no
// id e quebra na REDE.
//
// Por isso o teste fala com a funcao, e nao com o texto: um teste que le o fonte e casa
// expressao regular mede a FORMATACAO do codigo e passa enquanto a URL esta errada (foi
// exatamente o que aconteceu na primeira versao deste teste). Aqui a `pegarJson` e' trocada
// por uma que guarda a URL, e o que se verifica e' a URL.
test("a URL do /find tem o separador certo — sem isso o TMDB responde 401", async () => {
  const path = require("node:path");
  const http = require(path.join(ROOT, "src", "lib", "http.js"));
  const original = http.pegarJson;
  const vistos = [];
  // `tmdb.js` importa `pegarJson` por referencia no require; para trocar e preciso mexer no
  // cache do modulo, e o `tmdb.js` ja esta carregado por este arquivo.
  http.pegarJson = async (url) => {
    vistos.push(url);
    return { status: 200, ok: true, dados: { movie_results: [{ id: 603 }], tv_results: [] } };
  };
  globalThis.TMDB_API_KEY = "chave-de-teste";
  delete require.cache[require.resolve(path.join(ROOT, "src", "lib", "tmdb.js"))];
  const { tmdbIdDe } = require(path.join(ROOT, "src", "lib", "tmdb.js"));
  try {
    const id = await tmdbIdDe("tt0133093", false);
    assert.equal(id, "603", "tt0133093 tem que virar 603");
    assert.equal(vistos.length, 1, "sao esperadas 1 chamada (o /find)");
    const url = vistos[0];
    assert.match(url, /\?/, `a URL precisa ter '?' — sem ela o TMDB responde 401: ${url}`);
    assert.match(url, /\/find\/tt0133093(\?|&)api_key=/, `formato errado: ${url}`);
    assert.match(url, /external_source=imdb_id/, `falta o external_source: ${url}`);
  } finally {
    http.pegarJson = original;
    delete require.cache[require.resolve(path.join(ROOT, "src", "lib", "tmdb.js"))];
  }
});

// ── A CHAVE DO TMDB NO APARELHO ──
//
// MEDIDO 02/10/2026: rodando os 11 bundles de `public/` em Node, 10 deles LANCAM
// `TMDB_API_KEY ausente` e so o DGO devolve `[]` (ele usa a chave so para conferir o titulo).
// O `CONTRATO.md` diz que a global e' "injetada" pelo app — e nenhum codigo do repositorio a
// define em tempo de runtime: so as ferramentas Node (`teste.js`, `tools/medicao/bateria*.js`,
// `tools/e2e-usuario.js`) fazem isso, para conseguir medir.
//
// Sem a chave, as fontes que precisam do titulo nao funcionam NO APARELHO, e o defeito
// reaparece exatamente como antes: `[]` sem erro. O dono decidedo (02/10/2026): injetar.
//
// SOBRE O RISCO DE PUBLICAR A CHAVE: ela JA esta no repositorio e no historico publico —
// `mirrorstream/src/scrapers/tmdb.js` tem `TMDB_API_KEY || "5fcddff5…"` e o arquivo e'
// rastreado. Injetar no bundle nao expõe nada novo; o que muda e' que a chave passa a estar
// no endereco que o aparelho le. E' a chave da aplicacao da conta do dono, e nao uma de conta
// com escrita. Ainda assim: um dia troque a chave, e o build tem de puxar a de la, e nao ter
// uma copia escrita a mao aqui.
test("o build injeta uma chave do TMDB no bundle (o aparelho nao define a global)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const build = fs.readFileSync(path.join(ROOT, "build.js"), "utf8");
  assert.match(
    build,
    /TMDB_API_KEY/,
    "build.js nao injeta TMDB_API_KEY — no aparelho as fontes que precisam do titulo devolvem []"
  );
});

test("a chave injetada vem do servidor, e nao esta escrita a mao no repositorio do plugin", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = path.join(ROOT, "src");
  const escritos = [];
  const varre = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) { if (nome === "node_modules") continue; varre(p); continue; }
      if (!nome.endsWith(".js")) continue;
      const txt = fs.readFileSync(p, "utf8");
      if (/TMDB_API_KEY\s*\|\|\s*["'][0-9a-f]{20,}/i.test(txt)) escritos.push(path.relative(ROOT, p));
    }
  };
  varre(src);
  assert.deepEqual(
    escritos,
    [],
    `chave escrita a mao em: ${escritos.join(", ")} — ela tem que vir do mirrorstream/ no build, `
      + `para trocar a chave ser uma mudanca num lugar so`
  );
});

test("fonte-painel (o caminho de BLZ/SPC/ATO) resolve o id IMDb antes de consultar o painel", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const txt = fs.readFileSync(path.join(ROOT, "src", "lib", "fonte-painel.js"), "utf8");
  assert.match(
    txt,
    /tmdbIdDe\(/,
    "src/lib/fonte-painel.js nao resolve IMDb -> TMDB; BLZ, SPC e ATO devolvem [] para o id do Cinemeta"
  );
});

test("toda fonte que resolvia id por digito agora usa o modulo comum", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  // Os arquivos agora moram em `src/scrapers/<categoria>/` — o caminho vem do
  // proprio disco (o nome do arquivo nao muda com a categoria).
  const porNome = new Map(varrerScrapers().map((p) => [path.basename(p), p]));
  // Das 4 que tinham `idDe` proprio, 2 sairam do registro com a remocao das fontes mortas
  // (SPT/`playerflix.js` e VZR/`vizer.js`). Ficam as duas que continuam ativas: o RTD, que
  // resolve id por digito, e a de painel, que tambem tinha.
  const esperadas = ["redetoons.js", "doramogo.js"];
  for (const nome of esperadas) {
    const p = porNome.get(nome);
    assert.ok(p, `${nome} sumiu de src/scrapers/ — mudou de pasta?`);
    const txt = fs.readFileSync(p, "utf8");
    assert.match(
      txt,
      /require\("\.\.\/\.\.\/lib\/id-de-conteudo"\)/,
      `${nome} nao usa src/lib/id-de-conteudo.js — e' o que faz a fonte devolver [] para id IMDb`
    );
  }
});