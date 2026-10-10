// A ARVORE DO REPOSITORIO E' CONTRATO (spec §4).
//
// Os CLIs vivem em `tools/{medicao,validacao,publicacao}/` — um nivel mais fundo do que
// estavam. Um `path.join(__dirname, "..")` que sobrou aqui NAO estoura: resolve para
// `plugin/tools/`, que existe, e o script passa a ler o arquivo errado em silencio. E' o
// motivo de `tools/_caminhos.js` existir, e este arquivo fecha a porta de volta.
//
// Este arquivo cuida so do que a reorganizacao MOVEU. O conteudo de `src/` tem o seu
// proprio guarda, `test/runtime-aparelho.test.js`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const { RAIZ_REPO } = require("../tools/_caminhos");
const DIR_TOOLS = path.join(RAIZ, "tools");

// O proprio helper e' o unico arquivo que pode conhecer `__dirname` — e' ele quem resolve
// a raiz uma vez para todos. Sem esta exclusao o teste pediria o impossivel.
const EXCLUIDOS = new Set(["_caminhos.js"]);

// Devolve caminhos relativos a `plugin/`, com separador `/`, na mesma forma que
// `fontes.caminhoDe`. `varrerScrapers` do `categorias.test.js` faz o mesmo por `src/scrapers`.
function varrerTools(dir = DIR_TOOLS) {
  const saida = [];
  const anda = (atual) => {
    for (const nome of fs.readdirSync(atual).sort()) {
      const alvo = path.join(atual, nome);
      if (fs.statSync(alvo).isDirectory()) anda(alvo);
      else if (nome.endsWith(".js") && !EXCLUIDOS.has(nome)) {
        saida.push(path.relative(RAIZ, alvo).split(path.sep).join("/"));
      }
    }
  };
  if (fs.existsSync(dir)) anda(dir);
  return saida;
}

test("nenhum CLI monta caminho a partir de __dirname — todos usam tools/_caminhos", () => {
  // A regra mira a CONSTRUCAO de caminho, nao a palavra. `validacao/simular-sandbox.js`
  // contém `__dirname` de proposito — e' o token que ele PROIBE nos bundles do aparelho
  // (a linha `/\b__dirname\b|\b__filename\b/`), e um teste que acusasse ali obrigaria
  // enfraquecer a lista de proibidos do sandbox.
  const constroiCaminho = /path\.(?:join|resolve)\(\s*__dirname|`\$\{__dirname\}/;
  const violacoes = [];
  for (const p of varrerTools()) {
    const txt = fs.readFileSync(path.join(RAIZ, p), "utf8");
    if (constroiCaminho.test(txt)) violacoes.push(`${p}: constroi caminho a partir de __dirname`);
    if (/require\(\s*["']\.\.\/(src|dist|config)\//.test(txt)) violacoes.push(`${p}: require("../…/`);
  }
  assert.deepEqual(violacoes, []);
});

test("o helper de caminho aponta para plugin/ e para a raiz do repositorio", () => {
  const { RAIZ, RAIZ_REPO } = require("../tools/_caminhos");
  assert.equal(path.basename(RAIZ), "plugin");
  assert.ok(fs.existsSync(path.join(RAIZ_REPO, "plugin", "package.json")));
});

test("os tres grupos de ferramentas existem e nenhum CLI ficou na raiz de tools/", () => {
  for (const grupo of ["medicao", "validacao", "publicacao"]) {
    assert.ok(fs.existsSync(path.join(DIR_TOOLS, grupo)), `tools/${grupo}/ ausente`);
  }
  const soltos = fs.readdirSync(DIR_TOOLS).filter(n => n.endsWith(".js") && !EXCLUIDOS.has(n));
  assert.deepEqual(soltos, [], `CLI na raiz de tools/: ${soltos.join(", ")}`);
});

test("todo require relativo de tools/ resolve sem executar o CLI", () => {
  // `auditoria-contrato.js`, `bateria.js` e `monitorar-fontes.js` batem na rede real, entao
  // "smoke" deles seria esperar 60 s por fonte. Aqui a checagem e ESTATICA: extrai o
  // `require` relativo, resolve como o Node e cobra que o alvo exista. E' o que pega o
  // `require("../_caminhos")` com um `../` a mais sem precisar rodar nada.
  const quebrados = [];
  for (const p of varrerTools()) {
    // Linhas de comentario saem antes do `matchAll`: `servidor-api.js` documenta o contrato
    // com `require('./dist/<fonte>.js')` dentro de um `//`, e isso nao e' um require. Um
    // require de verdade pode estar no fim de uma linha de codigo com comentario depois —
    // esse caso o filtro aqui perde, e `npm test`/`node --check` do CI ainda cobrem.
    const txt = fs
      .readFileSync(path.join(RAIZ, p), "utf8")
      .split("\n")
      .filter(l => !/^\s*(?:\/\/|\*|\/\*)/.test(l))
      .join("\n");
    for (const m of txt.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
      const alvo = path.resolve(path.dirname(path.join(RAIZ, p)), m[1]);
      const resolvido = [`${alvo}.js`, path.join(alvo, "index.js")].find(c => fs.existsSync(c));
      if (!resolvido) quebrados.push(`${p} -> ${m[1]}`);
    }
  }
  assert.deepEqual(quebrados, []);
});

// ── A OPERACAO SAIU DA RAIZ ────────────────────────────────────────────────
// A raiz do repositorio era o arquivo de deploy, o script e o estudo do runtime ao mesmo
// tempo. A arvore nova e' `infra/{workers,edge}/` (o que roda e publica) e `docs/estudos/`
// (o que se learns). Estas tres asserções existem para a operacao nao voltar a subir.

const ALVOS_OPERACAO = [
  "infra/workers/mirror-cdn.js",
  "infra/workers/mirror-borda.mjs",
  "infra/workers/wrangler-cdn.toml",
  "infra/workers/wrangler-borda.toml",
  "infra/workers/deploy-workers.sh",
  "infra/workers/lista-workers.json",
  "infra/edge/nginx-kak.conf",
  "infra/edge/cloudflared-tunnel.service",
  "docs/estudos/nuvio-plugin-estudo.md",
];

// Documentos e scripts que o repo inteiro pode ler. Ficam de fora os arquivos cujo TRABALHO
// e' contar a historia: `CHANGELOG.md` diz "worker-simple.js saiu da raiz" — isso e' o
// registro do que mudou, nao um comando quebrado. O mesmo vale para `docs/`, que guarda
// estudos do passado. Um caminho velho ai e' historico; o mesmo caminho velho num `.sh` ou
// num `.yml` e' o proximo comando que quebra.
const HISTORIA = new Set(["CHANGELOG.md"]);
// Este proprio arquivo: a lista `VELHOS` abaixo e' feita de caminhos velhos, e um teste que
// se acusa e' um teste que ninguem roda.
const O_PROPRIO = "plugin/test/layout-repo.test.js";
function varrerDoc() {
  const RAIZES = [
    "README.md",
    "CHANGELOG.md",
    "AGENTS.md",
    "plugin",
    ".github",
    "infra",
  ];
  const PULA = new Set([".git", "node_modules", "dist", "public", ".superpowers", "logs"]);
  const saida = [];
  const anda = (atual) => {
    let nomes;
    try { nomes = fs.readdirSync(atual); } catch { return; }
    for (const nome of nomes) {
      if (PULA.has(nome) || nome === "public") continue;
      const alvo = path.join(atual, nome);
      const st = fs.statSync(alvo);
      if (st.isDirectory()) anda(alvo);
      else if (/\.(md|ya?ml|sh|toml|js|mjs|json)$/.test(nome)) {
        saida.push(path.relative(RAIZ_REPO, alvo).split(path.sep).join("/"));
      }
    }
  };
  for (const r of RAIZES) {
    const alvo = path.join(RAIZ_REPO, r);
    if (!fs.existsSync(alvo)) continue;
    if (fs.statSync(alvo).isDirectory()) anda(alvo);
    else saida.push(r);
  }
  return saida.filter(p => !p.startsWith("docs/") && !HISTORIA.has(p) && p !== O_PROPRIO).sort();
}

test("a operacao saiu da raiz e esta em infra/ e docs/estudos/", () => {
  assert.deepEqual(ALVOS_OPERACAO.filter(p => !fs.existsSync(path.join(RAIZ_REPO, p))), []);
});

test("nenhum arquivo do repo aponta para o caminho antigo de operacao", () => {
  // Os nomes que existiram na raiz. Um deles sobrevivendo num `.sh`, `.yml` ou `.md` e'
  // comando que o proximo a rodar quebra — ou doc que mente sobre onde o arquivo esta.
  const VELHOS = [
    /worker-simple\.js/,
    /worker-borda\.mjs/,
    /(^|[^\w/])estudos\/nuvio-plugin-estudo\.md/,
    /(^|[^\w/])deploy\/(nginx-kak|nginx-tunel|endereco-rapido|cloudflared-tunnel)/,
  ];
  const violacoes = [];
  for (const p of varrerDoc()) {
    const txt = fs.readFileSync(path.join(RAIZ_REPO, p), "utf8");
    for (const re of VELHOS) if (re.test(txt)) violacoes.push(`${p}: ${re}`);
  }
  assert.deepEqual(violacoes, []);
});

test("cada config do wrangler aponta para o arquivo que existe ao lado dele", () => {
  for (const cfg of ["wrangler-cdn.toml", "wrangler-borda.toml"]) {
    const arq = path.join(RAIZ_REPO, "infra", "workers", cfg);
    const m = fs.readFileSync(arq, "utf8").match(/^main\s*=\s*"([^"]+)"/m);
    assert.ok(m, `${cfg}: sem chave main`);
    assert.ok(fs.existsSync(path.join(path.dirname(arq), m[1])), `${cfg}: main = ${m[1]} nao existe ao lado`);
  }
});