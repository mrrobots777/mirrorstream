# Reorganização do repositório e scrapers por categoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar o repositório inteiro para refletir as quatro categorias de conteúdo (animes, filmes, series, doramas), dividir o registro das fontes por categoria, agrupar as ferramentas e mover operação/docs para fora da raiz — sem alterar um único byte dos bundles publicados.

**Architecture:** O caminho de cada scraper passa a ser derivado (`src/scrapers/<plural(conteudos[0])>/<arquivo>`) em vez de deduzido por quem chama. O registro único de 278 linhas vira um diretório com um arquivo por categoria e um `index.js` que faz merge preservando a API pública. Ferramentas ganham um helper de caminho (`tools/_caminhos.js`) para que mover um CLI um nível mais fundo não deixe `path.join(__dirname, "..")` apontando silenciosamente para a pasta errada.

**Tech Stack:** Node.js ≥18, CommonJS, zero dependências de runtime (só `esbuild` como devDependency), `node:test` + `node:assert/strict`, CI GitHub Actions em Ubuntu/Node 20.

**Spec:** `docs/superpowers/specs/2026-10-08-reorganizacao-categorias-design.md` — o plano argumenta a partir dele; quem executa lê os dois.

**Baseline medido em 2026-10-08 (não é promessa, é o ponto de partida):** `npm ci && npm test` → 29 testes, 0 falhas; `npm run sandbox` → as 10 fontes ativas carregam e exportam `getStreams`; `npm run build` → `git diff --stat -- 'plugin/public/*.js'` **vazio**, ou seja, o build é determinístico e o gate byte a byte da Tarefa 8 é aplicável. Ambiente local: Node v18.19.1, npm 9.2.0 (CI: Node 20).

**Desvio registrado do spec (§4.4):** `tools/teste-rota-worker.js` foi para `medicao/` e não para `validacao/`. Ele faz probe de rede (`require` de `provar-links.js` por caminho relativo ao próprio diretório, `teste-rota-worker.js:38`), então fica no grupo de medição para não criar require entre grupos. O spec foi atualizado.

## Global Constraints

- **Runtime do Nuvio:** código em `plugin/src/` não pode usar `require` de módulo Node, `process`, `Buffer`, `__dirname`, `WebAssembly`, `new Function`, DOM ou storage. Garantido por `plugin/test/runtime-aparelho.test.js` — nenhuma tarefa pode relaxar esse teste.
- **Nomes publicados estáveis:** `plugin/public/<chave>.js` e `plugin/public/manifest.json` não mudam de nome. O Nuvio faz cache por esse caminho.
- **Regra de categoria:** diretório ≡ `plural(conteudos[0])`, com `plural = {anime:"animes", filme:"filmes", serie:"series", dorama:"doramas"}`.
- **API pública de `plugin/src/core/fontes/` preservada:** `CONTEUDOS`, `DESCRICAO_REPOSITORIO`, `FONTES`, `GRUPOS`, `NOME_REPOSITORIO`, `VERSAO_REPOSITORIO`, `VERSAO_SCRAPER`, `arquivoDe`, `bundleDe`, `chaves`, `chavesTodos`, `conteudo`, `fonte`, `fontesComIndice`, `fontesDe`, `grupo`, `manifesto`, `prefixo`, `rotulo`, `scrapers`, `sigla`. Acrescentados: `diretorioDe`, `caminhoDe`, `porCategoria`.
- **`plugin/src/core/fontes/` continua sem acesso a sistema de arquivos** — `runtime-aparelho.test.js` varre todo `src/` e proíbe `require("fs")`. Caminhos são strings; quem varre diretório é `build.js` e cada teste.
- **Build determinístico:** a chave TMDB vem de `plugin/config/tmdb.js`. Rodar `npm run build` com `TMDB_API_KEY` no ambiente muda os bundles e invalida a comparação byte a byte.
- **Sem dependências novas.** Orçamentos do aparelho (60 s por fonte, 10 simultâneas, 1 MB de corpo) não mudam.

## Review Focus

1. **`TMDB_API_KEY` no ambiente mascara a prova byte a byte.** O build injeta a chave no bundle: com outra chave, os bundles mudam e a comparação falha por motivo alheio. Teste: `test/layout-repo.test.js` falha se `process.env.TMDB_API_KEY` estiver definido durante `npm test`.
2. **Um `path.join(__dirname, "..")` esquecido num CLI movido não lança** — resolve para `plugin/tools/`, que existe, e o script lê arquivo errado em silêncio. Teste: `test/layout-repo.test.js` varre `plugin/tools/**/*.js` e falha se algum arquivo (além de `_caminhos.js`) contiver a literal `__dirname` ou `require("../src/`.
3. **Se `src/core/fontes.js` sobreviver ao split, Node o prefere sobre `fontes/index.js`** e o registro dividido vira código morto sem erro nenhum. Teste: `test/registro.test.js` compara `require("../src/core/fontes") === require("../src/core/fontes/index")`.
4. **Os ~89 `require` relativos dos scrapers:** `node --check` (passo de sintaxe do CI) não resolve `require`, então um caminho quebrado passa lá e só estoura no esbuild. Teste: `test/categorias.test.js` extrai todos os `require("./…")` de `src/scrapers/**/*.js` e faz `fs.existsSync` do caminho resolvido — falha em `npm test`, não só no build.
5. **`plugin/public/manifest.json` é rastreado e VAI mudar** na Tarefa 3 (descrição "7 fontes" → contagem real), enquanto os bundles não podem mudar. Teste: `test/registro.test.js` trava `manifest.scrapers.length === fontes.chaves().length`; a verificação de bundles é `git diff --stat plugin/public -- '*.js'` vazio.

---

### Task 1: Scrapers nas pastas de categoria

**Files:**
- Create: `plugin/test/categorias.test.js`
- Move: os 15 arquivos de `plugin/src/scrapers/*.js` para as pastas da tabela da Interface "Produces"
- Modify: `plugin/src/core/fontes.js` (adiciona `diretorioDe`, `caminhoDe`)
- Modify: `plugin/build.js:9-11` (`arquivoDe`), `plugin/build.js:68-78` (`confereRegistro` — varredura recursiva)
- Modify: `plugin/tools/gerar-indice.js:58`
- Modify: `plugin/test/runtime-aparelho.test.js:96,111`

**Interfaces:**
- Consumes: `fontes.arquivoDe(chave)` → nome do arquivo (inalterado), `fontes.FONTES[chave].conteudos`.
- Produces:
  - `diretorioDe(chave) -> "animes" | "filmes" | "series" | "doramas"` — pasta da categoria principal.
  - `caminhoDe(chave) -> "src/scrapers/animes/otakulogia.js"` — caminho relativo a `plugin/`, separador `/`, derivado de `conteudos[0]`.
  - As 4 chamadas de caminho passam de `path.join(RAIZ, "src", "scrapers", arquivoDe(chave))` para `path.join(RAIZ, caminhoDe(chave))`.

Tabela de destino (saída de `chavesTodos()` com `conteudos`):

| dir | arquivos |
|---|---|
| `animes/` | `shinokai.js` `otakulogia.js` `animesdigital.js` `anitube.js` `aon.js` `isekai.js` `superanimes.js` `animefire.js` `redetoons.js` |
| `filmes/` | `playerflix.js` `painel-blaze.js` `painel-space.js` `painel-autos.js` `vizer.js` |
| `series/` | *(nenhum)* |
| `doramas/` | `doramogo.js` |

- [ ] **Step 1: Escrever o teste falhando**

Crie `plugin/test/categorias.test.js` com três testes. Os corpos dos auxiliares ficam com quem executa; as asserções são estas:

```js
const PLURAL = { anime: "animes", filme: "filmes", serie: "series", dorama: "doramas" };

test("todo scraper vive na pasta da sua categoria principal", () => {
  const errados = [];
  for (const chave of fontes.chavesTodos()) {
    const dir = PLURAL[fontes.FONTES[chave].conteudos[0]];
    const esperado = `src/scrapers/${dir}/${fontes.arquivoDe(chave)}`;
    if (fontes.caminhoDe(chave) !== esperado) errados.push(`${chave}: ${fontes.caminhoDe(chave)} != ${esperado}`);
    if (!fs.existsSync(path.join(RAIZ, fontes.caminhoDe(chave)))) errados.push(`${chave}: arquivo inexistente`);
  }
  assert.deepEqual(errados, []);
});

test("nenhum .js em src/scrapers fica fora do registro", () => {
  const declarados = new Set(fontes.chavesTodos().map(chave => fontes.caminhoDe(chave)));
  const orfaos = varrerScrapers().filter(p => !declarados.has(p));   // varrerScrapers: anda recursivo em src/scrapers, devolve caminhos relativos posix
  assert.deepEqual(orfaos, []);
});

test("as quatro pastas de categoria existem, mesmo a series/ vazia", () => {
  // O spec §7.5: series/ vazio e' aceito e deve continuar visivel — nao e' erro.
  const faltando = ["animes","filmes","series","doramas"]
    .filter(d => !fs.existsSync(path.join(RAIZ, "src", "scrapers", d)));
  assert.deepEqual(faltando, []);
  const jsEmSeries = fs.readdirSync(path.join(RAIZ, "src", "scrapers", "series"))
    .filter(n => n.endsWith(".js"));
  assert.deepEqual(jsEmSeries, [], "series/ so pode ganhar .js com conteudos[0] === serie");
});

test("todo require relativo de src/scrapers resolve para um arquivo que existe", () => {
  const quebrados = [];
  for (const p of varrerScrapers()) {
    const txt = fs.readFileSync(path.join(RAIZ, p), "utf8");
    for (const m of txt.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
      const alvo = path.join(path.dirname(p), m[1]);
      if (!fs.existsSync(path.join(RAIZ, alvo))) quebrados.push(`${p} -> ${m[1]}`);
    }
  }
  assert.deepEqual(quebrados, []);
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd plugin && node --test test/categorias.test.js`
Expected: FAIL — `fontes.caminhoDe is not a function`.

- [ ] **Step 3: Mover os 15 arquivos e reescrever os ~89 `require`**

`git mv` de cada arquivo para a pasta da tabela. Em todos os arquivos movidos, trocar o prefixo `require("../` por `require("../../` (89 ocorrências: `../lib/*` e `../core/sandbox`). Não há `require("../scrapers/…")` entre si.

- [ ] **Step 4: Implementar `diretorioDe` e `caminhoDe` em `plugin/src/core/fontes.js`**

```js
function diretorioDe(chave) { /* PLURAL[fonte(chave).conteudos[0]] */ }
function caminhoDe(chave)   { /* `src/scrapers/${diretorioDe(chave)}/${arquivoDe(chave)}` */ }
```

Exportar os dois no objeto de `module.exports`, junto dos existentes. Não usar `fs`.

- [ ] **Step 5: Apontar as 4 chamadas de caminho para `caminhoDe`**

`build.js:9-11` (`arquivoDe` local), `tools/gerar-indice.js:58`, `test/runtime-aparelho.test.js:96` e `:111` — todas deixam de montar `path.join(RAIZ, "src", "scrapers", arquivoDe(chave))` e passam a `path.join(RAIZ, fontes.caminhoDe(chave))`. Nas mensagens de erro dessas linhas, trocar `src/scrapers/${arquivoDe(chave)}` por `caminhoDe(chave)`.

- [ ] **Step 6: Tornar `confereRegistro()` recursivo em `plugin/build.js`**

`build.js:68-78` faz `fs.readdirSync(dir)` plano. Trocar por uma varredura recursiva sobre `src/scrapers/` que devolve caminhos relativos posix, e comparar esse conjunto com `chavesTodos().map(caminhoDe)`. As mensagens de erro continuam acumuladas e no plural.

- [ ] **Step 7: Rodar o teste para confirmar que passa**

Run: `cd plugin && node --test test/categorias.test.js`
Expected: PASS (3/3)

- [ ] **Step 8: Verificar que nenhum bundle mudou**

Run: `cd plugin && npm run build && git diff --stat plugin/public -- '*.js'`
Expected: saída vazia. Se houver diff, é `require` mal reescrito — volte ao Step 3.

- [ ] **Step 9: Commitar**

```bash
git add -A plugin/src plugin/build.js plugin/tools/gerar-indice.js plugin/test
git commit -m "refactor(plugin): scrapers nas pastas de categoria com caminho derivado"
```

---

### Task 2: Registro dividido por categoria

**Files:**
- Create: `plugin/src/core/fontes/animes.js`, `filmes.js`, `series.js`, `doramas.js`, `index.js`
- Delete: `plugin/src/core/fontes.js`
- Test: `plugin/test/registro.test.js`

**Interfaces:**
- Consumes: `diretorioDe`, `caminhoDe` da Tarefa 1; o mapa `FONTES` completo de `src/core/fontes.js`.
- Produces: `plugin/src/core/fontes/index.js` exportando **exatamente** os 21 nomes da lista de Global Constraints, mais `diretorioDe`, `caminhoDe`, `porCategoria()`.
  - `porCategoria() -> { animes: string[], filmes: string[], series: string[], doramas: string[] }` — todas as chaves declaradas (inclusive as desativadas), na mesma ordem de `chavesTodos()`, agrupadas por `diretorioDe`.
  - `series.js` exporta `{}` e não é erro.

- [ ] **Step 1: Escrever o teste falhando**

`plugin/test/registro.test.js`:

```js
const API_ESPERADA = ["CONTEUDOS","DESCRICAO_REPOSITORIO","FONTES","GRUPOS","NOME_REPOSITORIO",
  "VERSAO_REPOSITORIO","VERSAO_SCRAPER","arquivoDe","bundleDe","chaves","chavesTodos","conteudo",
  "fonte","fontesComIndice","fontesDe","grupo","manifesto","prefixo","rotulo","scrapers","sigla",
  "diretorioDe","caminhoDe","porCategoria"];

test("src/core/fontes resolve para o index e nao para um fontes.js sobrevivente", () => {
  assert.equal(require("../src/core/fontes"), require("../src/core/fontes/index"));
});

test("a API publica do registro e exatamente a combinada", () => {
  assert.deepEqual(Object.keys(require("../src/core/fontes")).sort(), API_ESPERADA.slice().sort());
});

test("porCategoria cobre toda chave declarada, uma vez so", () => {
  const g = fontes.porCategoria();
  assert.deepEqual(Object.keys(g), ["animes","filmes","series","doramas"]);
  const tudo = Object.values(g).flat();
  assert.deepEqual(tudo.sort(), fontes.chavesTodos().slice().sort());
  assert.equal(new Set(tudo).size, tudo.length);
});

test("o manifesto declara exatamente as fontes ativas", () => {
  assert.equal(fontes.manifesto().scrapers.length, fontes.chaves().length);
});

test("todo conteudo declarado esta em CONTEUDOS e todo conteudo existe em algum arquivo", () => {
  // Spec §7.4 — a protecao contra digitação em series.js/vazio apos o split.
  const fora = [];
  for (const chave of fontes.chavesTodos()) {
    for (const c of fontes.FONTES[chave].conteudos) {
      if (!fontes.CONTEUDOS.includes(c)) fora.push(`${chave}: "${c}"`);
    }
  }
  assert.deepEqual(fora, []);
  assert.deepEqual(fontes.porCategoria().series, [], "series/ so aceita fonte com conteudos[0] === serie");
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd plugin && node --test test/registro.test.js`
Expected: FAIL — `porCategoria is not a function`.

- [ ] **Step 3: Dividir o registro**

Criar os 4 arquivos de categoria contendo só as entradas correspondentes de `FONTES` (`module.exports = { shg: {...}, ... }`), na ordem atual. `series.js` exporta `{}`. `index.js` monta `FONTES` fazendo merge na ordem `animes, filmes, series, doramas` e mantém a ordem original de `chavesTodos()` (a ordem de hoje é a ordem de declaração no arquivo único — copie-a para um array `ORDEM` no `index.js` e derive `chavesTodos()` dele, para o manifesto não reordenar).

`index.js` mantém as funções e constantes de `fontes.js` sem alteração de assinatura, acrescentando `diretorioDe`, `caminhoDe`, `porCategoria`. `DESCRICAO_REPOSITORIO` continua declarado como constante de string — a contagem vem na Tarefa 3.

- [ ] **Step 4: Apagar `plugin/src/core/fontes.js`**

Se ele sobreviver, o Node o prefere sobre o diretório e nada do que foi feito acima roda. Confirme com `node -e 'console.log(require.resolve("./src/core/fontes"))'` que resolve para `…/fontes/index.js`.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd plugin && npm test`
Expected: PASS — todos os testes, incluindo os 4 pré-existentes.

- [ ] **Step 6: Commitar**

```bash
git add -A plugin/src/core plugin/test/registro.test.js
git commit -m "refactor(plugin): registro das fontes dividido por categoria"
```

---

### Task 3: Contagem derivada (descrição "7 fontes" → real)

**Files:**
- Modify: `plugin/src/core/fontes/index.js` (`DESCRICAO_REPOSITORIO`)
- Modify: `plugin/package.json:4` (`description`)
- Modify: `.github/workflows/publicar-pages.yml:46`
- Test: `plugin/test/registro.test.js` (asserção nova, primeiro)

**Interfaces:**
- Consumes: `chaves()`, `manifesto()` da Tarefa 2.
- Produces: `DESCRICAO_REPOSITORIO` contendo o número literal de `chaves().length`; o passo de validação do workflow comparando contra o registro em vez de `7`.

- [ ] **Step 1: Escrever a asserção falhando**

Acrescentar em `plugin/test/registro.test.js`:

```js
test("a descricao do repositorio tem a contagem real de fontes ativas", () => {
  const n = fontes.chaves().length;
  assert.ok(fontes.DESCRICAO_REPOSITORIO.includes(`${n} fonte`),
    `descricao: "${fontes.DESCRICAO_REPOSITORIO}" nao declara ${n} fontes`);
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `cd plugin && node --test test/registro.test.js`
Expected: FAIL — a descrição diz "7 fontes" e `chaves()` devolve 10.

- [ ] **Step 3: Derivar a descrição**

Em `index.js`, `DESCRICAO_REPOSITORIO` passa a ser construída com `chaves().length`. Declare-a **depois de `const FONTES`** (as funções `chaves`/`chavesTodos` fazem hoisting, mas `FONTES` é `const` e não — na ordem errada o módulo estoura `Cannot access 'FONTES' before initialization`). Mantenha o restante da frase igual.

- [ ] **Step 4: Corrigir `plugin/package.json`**

`description: "MirrorStream — plugin Nuvio VOD: 7 fontes de anime, filmes, séries e doramas"` — remover o número (o `package.json` não é gerado e sairia de novo de sincronia a cada fonte ligada/desligada).

- [ ] **Step 5: Corrigir a validação do workflow**

`.github/workflows/publicar-pages.yml:46` troca `m.scrapers.length !== 7` por comparação com o registro:

```yaml
node -e 'const m=require("./public/manifest.json"), f=require("./src/core/fontes"); if(m.scrapers.length!==f.chaves().length) process.exit(1); console.log(`manifesto: ${m.scrapers.length} scrapers`);'
```

- [ ] **Step 6: Rodar testes e build**

Run: `cd plugin && npm test && npm run build`
Expected: PASS. `git diff plugin/public/manifest.json` mostra **só** a linha `description`; `git diff --stat plugin/public -- '*.js'` continua vazio.

- [ ] **Step 7: Commitar**

```bash
git add -A plugin/src/core plugin/package.json .github/workflows/publicar-pages.yml plugin/test plugin/public/manifest.json
git commit -m "fix: descricao e validacao do manifesto derivam da contagem real de fontes"
```

---

### Task 4: Ferramentas agrupadas com helper de caminho

**Files:**
- Create: `plugin/tools/_caminhos.js`
- Move: 12 arquivos de `plugin/tools/` para `medicao/` (8), `validacao/` (2), `publicacao/` (2)
- Modify: `plugin/package.json` (`scripts`), `.github/workflows/*.yml`, os 12 CLIs (caminhos)
- Test: `plugin/test/layout-repo.test.js` (criado aqui)

**Interfaces:**
- Consumes: nada das tarefas anteriores além do registro.
- Produces:
  - `plugin/tools/_caminhos.js` → `{ RAIZ, RAIZ_REPO }`, sendo `RAIZ = plugin/` e `RAIZ_REPO = raiz do repositório`.
  - `test/layout-repo.test.js` com as asserções do Step 1.

Distribuição (o agrupamento de `teste-rota-worker` é o desvio registrado no cabeçalho):

| pasta | arquivos |
|---|---|
| `medicao/` | `bateria.js` `bateria-completa.js` `casos.js` `e2e-usuario.js` `provar-links.js` `medir-rotas.js` `monitorar-fontes.js` `teste-rota-worker.js` |
| `validacao/` | `simular-sandbox.js` `auditoria-contrato.js` |
| `publicacao/` | `gerar-indice.js` `servidor-api.js` |

- [ ] **Step 1: Escrever o teste falhando**

`plugin/test/layout-repo.test.js`:

```js
test("nenhum CLI monta caminho a partir de __dirname — todos usam tools/_caminhos", () => {
  const violacoes = [];
  for (const p of varrerTools()) {                       // recursivo sobre plugin/tools, exclui _caminhos.js
    const txt = fs.readFileSync(path.join(RAIZ, p), "utf8");
    if (/\b__dirname\b/.test(txt)) violacoes.push(`${p}: __dirname`);
    if (/require\(\s*["']\.\.\/(src|dist|config)\//.test(txt)) violacoes.push(`${p}: require("../…/`);
  }
  assert.deepEqual(violacoes, []);
});

test("o helper de caminho aponta para plugin/ e para a raiz do repositorio", () => {
  const { RAIZ, RAIZ_REPO } = require("../tools/_caminhos");
  assert.equal(path.basename(RAIZ), "plugin");
  assert.ok(fs.existsSync(path.join(RAIZ_REPO, "plugin", "package.json")));
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `cd plugin && node --test test/layout-repo.test.js`
Expected: FAIL — `Cannot find module '../tools/_caminhos'`.

- [ ] **Step 3: Criar `plugin/tools/_caminhos.js`**

Dois caminhos resolvidos a partir de `__dirname`, exportados como `RAIZ` e `RAIZ_REPO`. É o único arquivo de `tools/` que pode conter `__dirname`.

- [ ] **Step 4: Mover os 12 CLIs e apontar todos os caminhos para o helper**

`git mv` para as pastas da tabela. Em cada arquivo movido, substituir a montagem de caminho por `require("../_caminhos")`:

| hoje (uma linha por arquivo) | depois |
|---|---|
| `path.join(__dirname, "..")` / `const raiz = path.join(__dirname, "..")` / `const RAIZ = path.join(__dirname, "..")` | `RAIZ` vindo de `../_caminhos` |
| `path.join(__dirname, "..", "dist"\|"config"\|"src", …)` | `path.join(RAIZ, "dist"\|"config"\|"src", …)` |
| `require("../src/…")` | `require("../../src/…")` |
| `require("./casos")`, `require("./provar-links")` | **sem mudança** (mesmo grupo) |
| `bateria.js:36` `require("../tools/provar-links.js")` | `require("./provar-links")` |
| `teste-rota-worker.js:38` `require(path.join(__dirname, "provar-links.js"))` | `require("./provar-links")` (agora mesmo grupo) |
| `teste-rota-worker.js:27` `path.join(__dirname, "..", "..", ".env.example")` | `path.join(RAIZ_REPO, ".env.example")` |

Arquivos que usam `raiz`/`RAIZ` local (`e2e-usuario.js:14`, `monitorar-fontes.js:9`, `servidor-api.js:64`, `gerar-indice.js:8`, `casos.js:12`, `simular-sandbox.js:30,137`) — o nome local pode continuar, só muda a origem.

- [ ] **Step 5: Atualizar scripts e workflows**

`plugin/package.json` — os 7 scripts apontam para os novos caminhos (`tools/medicao/monitorar-fontes.js`, `tools/validacao/simular-sandbox.js`, `tools/publicacao/servidor-api.js`, `tools/medicao/medir-rotas.js`). `.github/workflows/publicar-pages.yml:38` → `node tools/publicacao/gerar-indice.js`. `.github/workflows/testes.yml:24` → `find src tools -name '*.js'` no passo de `node --check`.

- [ ] **Step 6: Rodar o teste e a suíte**

Run: `cd plugin && node --test test/layout-repo.test.js && npm test && npm run build && npm run sandbox`
Expected: PASS nos cinco.

- [ ] **Step 7: Smoke das ferramentas offline**

Run: `cd plugin && node tools/validacao/auditoria-contrato.js && node tools/validacao/simular-sandbox.js --sem-rede`
Expected: saída normal, sem `Cannot find module` nem caminho inexistente.

- [ ] **Step 8: Commitar**

```bash
git add -A plugin/tools plugin/package.json .github/workflows plugin/test
git commit -m "refactor(tools): CLIs agrupados em medicao/validacao/publicacao com helper de caminho"
```

---

### Task 5: Operação para `infra/`, estudos para `docs/`, lista de workers única

**Files:**
- Move: `worker-simple.js` → `infra/workers/mirror-cdn.js`; `worker-borda.mjs` → `infra/workers/mirror-borda.mjs`; `wrangler.toml` → `infra/workers/wrangler-cdn.toml`; `wrangler-borda.toml` → `infra/workers/wrangler-borda.toml`; `deploy-workers.sh` → `infra/workers/deploy-workers.sh`; `deploy/` → `infra/edge/`; `estudos/` → `docs/estudos/`
- Create: `infra/workers/lista-workers.json`
- Modify: `plugin/tools/publicacao/gerar-indice.js:29-38`, `plugin/MONITORAMENTO.md:129,208,230`, `plugin/CONTRATO.md:4`, comentários nos tomls e no script
- Test: `plugin/test/layout-repo.test.js` (asserções novas, primeiro)

**Interfaces:**
- Consumes: `RAIZ_REPO` de `tools/_caminhos` (Tarefa 4).
- Produces:
  - `infra/workers/lista-workers.json` → objeto plano `{ "blz": "mirror-blz", "spc": "mirror-spc", "ato": "mirror-ato" }` (conteúdo tirado de `gerar-indice.js:29-33`).
  - `gerar-indice.js` lê esse arquivo em vez de manter o mapa próprio.

- [ ] **Step 1: Escrever as asserções falhando**

Acrescentar em `plugin/test/layout-repo.test.js`:

```js
const ALVOS = [
  "infra/workers/mirror-cdn.js", "infra/workers/mirror-borda.mjs",
  "infra/workers/wrangler-cdn.toml", "infra/workers/wrangler-borda.toml",
  "infra/workers/deploy-workers.sh", "infra/workers/lista-workers.json",
  "infra/edge/nginx-kak.conf", "infra/edge/cloudflared-tunnel.service",
  "docs/estudos/nuvio-plugin-estudo.md",
];

test("a operacao saiu da raiz e esta em infra/ e docs/estudos/", () => {
  assert.deepEqual(ALVOS.filter(p => !fs.existsSync(path.join(RAIZ_REPO, p))), []);
});

test("nenhum arquivo do repo referencia um caminho antigo", () => {
  const proibido = /worker-simple\.js|worker-borda\.mjs|(^|["'`( ])deploy-workers\.sh|["'`( ]estudos\/|main = "worker-/;
  // varre README.md, *.md de plugin/, .github/workflows/*, infra/**, excluindo docs/superpowers e docs/estudos
  assert.deepEqual(violacoes, []);
});

test("wrangler aponta para o arquivo que existe ao lado do config", () => {
  const toml = fs.readFileSync(path.join(RAIZ_REPO, "infra/workers/wrangler-cdn.toml"), "utf8");
  const main = toml.match(/^main\s*=\s*"([^"]+)"/m)[1];
  assert.ok(fs.existsSync(path.join(RAIZ_REPO, "infra/workers", main)));
  // idem para wrangler-borda.toml
});
```

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `cd plugin && node --test test/layout-repo.test.js`
Expected: FAIL — 9 caminhos ausentes.

- [ ] **Step 3: Mover os arquivos com `git mv`**

As 7 movimentações do cabeçalho da tarefa. `deploy/` → `infra/edge/`, `estudos/` → `docs/estudos/`.

- [ ] **Step 4: Corrigir `main` e comentários dos configs**

`infra/workers/wrangler-cdn.toml`: `main = "worker-simple.js"` → `"mirror-cdn.js"`. `infra/workers/wrangler-borda.toml:41`: `main = "worker-borda.mjs"` → `"mirror-borda.mjs"`. Atualizar nos dois os comentários que citam `wrangler.toml da raiz` e `deploy-workers.sh` pelo caminho novo. O comentário de `wrangler-cdn.toml:13-14` explica que o config temporário do deploy fica ao lado do código — depois da mudança "ao lado" é `infra/workers/`, o que continua verdadeiro.

- [ ] **Step 5: Consertar `infra/workers/deploy-workers.sh`**

- `cd "$(dirname "$0")"` já garante que `$PWD` é `infra/workers/` — o config temporário `.wrangler-<sigla>.toml` e o `MAIN` ficam juntos do código, que é a premissa documentada em `wrangler-cdn.toml:5-6`.
- `MAIN=worker-simple.js` → `MAIN=mirror-cdn.js`.
- O bloco `lista=$(… require("./src/core/nomes") …)` (linha 41-44, arquivo inexistente) passa a ler `lista-workers.json` ao lado do script e imprimir `chave nome` por linha, com o mesmo formato de saída.
- Comentários das linhas 47 e 54 citam `worker-simple.js` → `mirror-cdn.js`.

- [ ] **Step 6: `gerar-indice.js` lê a lista única**

Trocar o mapa `WORKERS` de `gerar-indice.js:29-33` pela leitura de `path.join(RAIZ_REPO, "infra", "workers", "lista-workers.json")`. Mantenha `workerDe(fonte)` com a mesma assinatura e o mesmo `WORKER_SUFFIX`.

- [ ] **Step 7: Atualizar as referências em docs**

`plugin/MONITORAMENTO.md` (3 ocorrências de `worker-simple.js` → `infra/workers/mirror-cdn.js`) e `plugin/CONTRATO.md:4` (`estudos/nuvio-plugin-estudo.md` → `docs/estudos/nuvio-plugin-estudo.md`).

- [ ] **Step 8: Rodar testes e build**

Run: `cd plugin && npm test && npm run build`
Expected: PASS — as asserções novas de `layout-repo.test.js` e as 3 suítes pré-existentes.

- [ ] **Step 9: Commitar**

```bash
git add -A infra docs/estudos plugin
git rm -q --cached worker-simple.js worker-borda.mjs wrangler.toml wrangler-borda.toml deploy-workers.sh 2>/dev/null || true
git commit -m "chore: operacao para infra/, estudos para docs/, lista de workers unica"
```

---

### Task 6: Agregação por categoria nas medições

**Files:**
- Create: `plugin/tools/medicao/resumo.js`
- Modify: `plugin/tools/medicao/bateria.js:79-81`, `plugin/tools/medicao/monitorar-fontes.js:75-76`
- Test: `plugin/test/agregador.test.js`

**Interfaces:**
- Consumes: `fontes.diretorioDe` (Tarefa 1).
- Produces:
  - `agrupaPorCategoria(itens, diretorioDe) -> Array<{ categoria, total, ok }>` — `itens: Array<{ chave, ok }>`, ordem fixa `["animes","filmes","series","doramas"]`, sempre as 4 categorias mesmo com 0 itens.
  - `linhaPorCategoria(grupos) -> string` — `"animes 6/9 | filmes 4/5 | series 0/0 | doramas 1/1"`.

- [ ] **Step 1: Escrever o teste falhando**

`plugin/test/agregador.test.js`:

```js
test("agrupa por categoria na ordem fixa e sempre devolve as quatro", () => {
  const itens = [{ chave: "shg", ok: true }, { chave: "blz", ok: true },
                 { chave: "dgo", ok: false }, { chave: "ise", ok: false }];
  assert.deepEqual(agrupaPorCategoria(itens, dir => dir), [
    { categoria: "animes", total: 2, ok: 1 },
    { categoria: "filmes", total: 1, ok: 1 },
    { categoria: "series", total: 0, ok: 0 },
    { categoria: "doramas", total: 1, ok: 0 },
  ]);
});

test("categoria vazia entra com 0/0 e a linha e estavel", () => {
  const g = agrupaPorCategoria([], () => "animes");
  assert.equal(linhaPorCategoria(g), "animes 0/0 | filmes 0/0 | series 0/0 | doramas 0/0");
});
```

(O segundo teste recebe o `diretorioDe` mockado de propósito: a função não pode depender do registro para ser testável.)

- [ ] **Step 2: Rodar para confirmar que falha**

Run: `cd plugin && node --test test/agregador.test.js`
Expected: FAIL — `Cannot find module '../tools/medicao/resumo'`.

- [ ] **Step 3: Implementar `plugin/tools/medicao/resumo.js`**

As duas funções, puras, sem `require` de rede nem do registro.

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `cd plugin && node --test test/agregador.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Ligar nas duas ferramentas**

`bateria.js` imprime a linha de categoria logo após o resumo da linha 80, com `ok` = `r.streams > 0 && r.vivos > 0`. `monitorar-fontes.js` acrescenta `porCategoria` ao objeto `resumo` (linha 62) e imprime a linha após o resultado (linha 75), com `ok` = `record.status === "ok"`.

- [ ] **Step 6: Rodar a suíte**

Run: `cd plugin && npm test`
Expected: PASS — 4 suítes novas + as 4 pré-existentes.

- [ ] **Step 7: Commitar**

```bash
git add plugin/tools/medicao plugin/test/agregador.test.js
git commit -m "feat(medicao): resultado agregado por categoria em bateria e monitoramento"
```

---

### Task 7: Documentação

**Files:**
- Create: `docs/fontes/2026-10-08-fenixflix-estudo.md`
- Create: `docs/fontes/politica-de-fontes.md`
- Create: `plugin/src/scrapers/series/README.md`
- Modify: `README.md`, `plugin/README.md`, `plugin/CONTRATO.md` (árvore, linhas 127-133), `CHANGELOG.md`

**Interfaces:**
- Consumes: tudo das Tarefas 1-6 (a árvore final).
- Produces: quatro documentos com o conteúdo dos Steps.

- [ ] **Step 1: Gravar o estudo FenixFlix**

`docs/fontes/2026-10-08-fenixflix-estudo.md` com os fatos medidos em 2026-10-08: manifesto (`com.fenixflix` v1.2.0, `resources: ["stream","catalog"]`, `idPrefixes: tt|tmdb|dramabox|kitsu`); `openapi.json` com 3 rotas Stremio + `/tproxy/{short_id}` ("Tomato Proxy") + `/admin/banned`; os 4 backends próprios (`husky-denny-*.koyeb.app`, `passing-melinda-*.koyeb.app`, `fenixflix-fenixstudio.hf.space`, `fenixbot.squareweb.app`) servindo MP4 com `?hash=`; hash não portátil entre hosts (medido: 404); "Proxy link expired or invalid"; config na URL decorativo (`lixo/manifest.json` devolve o mesmo manifesto); catálogos (`recentes_servidor` = 40 metas sem paginação, `populares_fenix` = vazio, `search=` funciona, `meta/*` = 404, `kitsu:`/`dramabox:` = vazio); conclusão de que não há scraper a extrair e decisão de descartar.

- [ ] **Step 2: Escrever a política de fontes**

`docs/fontes/politica-de-fontes.md`: o que faz uma fonte entrar (ao menos um link verificável, medido), sair (`ativo: false` + `motivo` medido com data), e como 403/429/DNS/expiração de CDN são falha da origem e não do plugin (já é a regra do `README.md` — consolidar aqui). Incluir a tabela de contagem por categoria derivada do registro.

- [ ] **Step 3: Explicar a pasta vazia**

`plugin/src/scrapers/series/README.md`: por que existe e está vazia (nenhuma fonte tem `serie` como `conteudos[0]`), qual a regra de destino e o que fazer ao criar a primeira fonte primária de série.

- [ ] **Step 4: Atualizar os docs existentes**

- `README.md`: árvore do repositório, tabela de fontes por categoria (animes 9, filmes 5, series 0, doramas 1 — declaradas; 10 ativas), caminhos de `tools/`.
- `plugin/README.md`: mesma tabela na visão do plugin.
- `plugin/CONTRATO.md`: árvore dos linhas 127-133 com as pastas de categoria e o novo agrupamento de `tools/`.
- `CHANGELOG.md`: entrada para a reorganização.

- [ ] **Step 5: Provar que nenhuma referência sobrou**

Run: `grep -rn "worker-simple\|worker-borda\|deploy/\|estudos/\|src/scrapers/[a-z]*\.js" README.md plugin/*.md docs/fontes .github/workflows infra | grep -v "src/scrapers/series/"`
Expected: sem saída.

- [ ] **Step 6: Commitar**

```bash
git add docs/fontes plugin/src/scrapers/series/README.md README.md plugin/README.md plugin/CONTRATO.md CHANGELOG.md
git commit -m "docs: estudo fenixflix, politica de fontes e arvore atualizada"
```

---

### Task 8: Gate final

**Files:**
- Modify: nenhum (verificação)

**Interfaces:**
- Consumes: as saídas das Tarefas 1-7.
- Produces: evidência de aceite para os 5 critérios do spec.

- [ ] **Step 1: Suíte completa do CI, localmente**

Run: `cd plugin && npm ci --no-audit --no-fund && npm test && npm run build && npm run sandbox`
Expected: os quatro em sequência, sem falha.

- [ ] **Step 2: Prova byte a byte dos bundles**

Run: `cd /home/ubuntu/mirrorstream && git diff --stat HEAD -- 'plugin/public/*.js'`
Expected: saída vazia (nenhum bundle mudou desde o último commit).

- [ ] **Step 3: Manifesto consistente**

Run: `cd plugin && node -e 'const m=require("./public/manifest.json"),f=require("./src/core/fontes"); console.log(m.scrapers.length, f.chaves().length, m.description)'`
Expected: `10 10 MirrorStream — 10 fontes VOD ativas…`.

- [ ] **Step 4: Smoke da API**

Run: `cd plugin && npm run api` em background; depois `curl -s localhost:PORT/health` e `curl -s localhost:PORT/manifest.json`
Expected: `200` nas duas, manifesto com 10 scrapers. Encerrar o processo.

- [ ] **Step 5: Prova de trabalho do deploy dos workers (sem publicar)**

Run: `cd infra/workers && bash -n deploy-workers.sh && node -e 'const l=require("./lista-workers.json"); console.log(Object.keys(l))'`
Expected: sintaxe OK e `[ 'blz', 'spc', 'ato' ]`. Nenhum `wrangler deploy` é executado nesta etapa.

- [ ] **Step 6: Verificação final de referências obsoletas**

Run: `grep -rn "worker-simple\|worker-borda\|src/core/nomes\|tools/bateria\|tools/monitorar\|tools/simular\|tools/servidor\|tools/gerar" --include='*.yml' --include='*.json' --include='*.md' . | grep -v node_modules | grep -v docs/superpowers`
Expected: sem saída.

- [ ] **Step 7: Commitar a evidência**

```bash
git add -A && git status --short
git commit -m "chore: gate final da reorganizacao — suíte, bundles identicos, API no ar"
```
