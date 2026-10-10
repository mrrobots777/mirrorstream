# Reorganização do repositório e scrapers por categoria — design

- **Data:** 2026-10-08
- **Status:** aguardando revisão do parceiro
- **Sub-projeto:** A de 5 (A reorganização → B motores → C API → D documentação → E multiplataforma)
- **Escopo deste documento:** somente o sub-projeto A.

## 1. Contexto

O plugin Nuvio do MirrorStream entrega 15 fontes declaradas (10 ativas) por um registro único
`plugin/src/core/fontes.js` de 278 linhas e um diretório plano `plugin/src/scrapers/` com 15
arquivos. Não há separação por categoria de conteúdo: um dev procura "o scraper de dorama" entre
arquivos de anime, painel Xtream e player de filme.

A categoria de conteúdo **já existe como metadado** (`conteudos: ["anime"|"filme"|"serie"|"dorama"]`)
e é usada por `fontesDe()`. O que falta é o código fisicamente refletir essa categoria.

Ao mesmo tempo, a raiz do repositório tem arquivos de operação soltos (`worker-simple.js`,
`worker-borda.mjs`, `wrangler.toml`, `wrangler-borda.toml`, `deploy-workers.sh`, `deploy/`,
`estudos/`) misturados com o produto.

## 2. Intenção

Um dev que abra o repositório deve saber em poucos segundos onde está o scraper de cada categoria,
onde está o código de operação e onde está a documentação — sem ler o registro inteiro. A
reorganização é **interna**: o artefato publicado no GitHub Pages (`public/<chave>.js` e
`manifest.json`) não muda de nome nem de conteúdo, e o plugin já instalado no Nuvio não é afetado.

### Restrições (dadas, não negociadas)

- O Nuvio executa o plugin no sandbox do aparelho (QuickJS): sem Node, sem DOM, sem storage.
  Nenhuma mudança pode introduzir API que não exista lá.
- O runtime recebe apenas `getStreams(tmdbId, mediaType, season, episode)`. Não há campo de
  categoria no manifesto do Nuvio — a categorização é organizacional, não de contrato.
- O CI roda em Linux com Node 20 (`node --test`, `esbuild`).
- Orçamento do aparelho: 60 s por invocação, 10 invocações simultâneas, corpo de 1 MB.

### Sucesso

1. `npm ci && npm test && npm run build` verde.
2. `plugin/public/*.js` byte a byte idêntico ao estado anterior.
3. Zero referência a path antigo em workflows, scripts e docs.
4. Um scraper novo cai no diretório certo sem decisão do autor.

## 3. Decisões tomadas

| # | Decisão | Racional |
|---|---|---|
| 1 | FenixFlix é **descartado** como fonte | Investigação mostrou que não é um scraper: é uma biblioteca fechada própria (MP4 servido por backends Koyeb/HF/SquareWeb com token `hash` não portátil), com dashboard de ban de IP. Não há o que extrair. O achado vai para `docs/fontes/`. |
| 2 | Ordem A → B → C → D → E | A reorganização é base para motores, API, docs e validação. Refazer estrutura depois duplica esforço. |
| 3 | Reorganizar o **repo inteiro** | O pedido foi "organizar todo o repositório". Worker, deploy e estudos são operação e saem da raiz. |
| 4 | Diretório = **categoria principal** (`conteudos[0]`), sem pasta `misto` | Uma fonte tem exatamente um lugar; a lista completa continua em `conteudos`. Zero duplicação. |
| 5 | 4 pastas (`animes/ filmes/ series/ doramas/`), `series/` vazio e documentado | Nenhuma fonte tem `serie` como `conteudos[0]`. Criar a pasta vazia deixa a estrutura visível e a regra testável. |
| 6 | Registro **dividido por categoria** em `src/core/fontes/`, com API pública idêntica | Cresce por arquivo, não por linha; `require("./src/core/fontes")` continua resolvendo. |
| 7 | `src/lib/` **permanece plano** | 18 arquivos, maioria < 200 linhas. Agrupar mexeria em dezenas de `require` dos 15 scrapers sem benefício proporcional; a extração de motores acontece no sub-projeto B. |
| 8 | `tools/` agrupado em `medicao/`, `validacao/`, `publicacao/` | Separa CLIs de rede (caros, com rate limit) dos offline e dos de publicação. |

## 4. Layout alvo

### 4.1 Raiz

```
mirrorstream/
├── README.md  CHANGELOG.md  .env.example  .gitignore
├── plugin/                        # inalterado por fora
│
├── infra/                         # operação
│   ├── workers/
│   │   ├── mirror-cdn.js          # era worker-simple.js
│   │   ├── mirror-borda.mjs       # era worker-borda.mjs
│   │   ├── wrangler-cdn.toml      # era wrangler.toml (main: corrigido)
│   │   ├── wrangler-borda.toml
│   │   └── lista-workers.json     # lista de workers a publicar (blz, spc, ato, …)
│   ├── deploy-workers.sh          # consertado (ver §6)
│   └── edge/                      # era ./deploy/ (nginx, cloudflared, endereco-rapido.sh)
│
├── docs/
│   ├── superpowers/{specs,plans}/ # inalterado — convenção dos artefatos de design
│   ├── estudos/                   # era ./estudos/ (nuvio-plugin-estudo.md)
│   └── fontes/                    # novo
│
└── .github/workflows/             # paths atualizados
```

### 4.2 Scrapers

```
plugin/src/scrapers/
├── animes/     otakulogia  animesdigital  anitube  isekai  superanimes
│               shinokai  aon  animefire  redetoons            (9)
├── filmes/     painel-blaze  painel-space  painel-autos  playerflix  vizer   (5)
├── series/     README.md — por que a pasta está vazia          (0)
└── doramas/    doramogo                                        (1)
```

Atribuição por chave: `shg, ron, atb, ise, san, ski, aon, anf, rtd → animes/`;
`spt, blz, spc, ato, vzr → filmes/`; `dgo → doramas/`.

**Reescrita mecânica de requires.** Os 15 scrapers fazem ~87 chamadas relativas
(`require("../lib/http")`, `require("../core/sandbox")`). Ao ganharem um nível de profundidade,
todas viram `../../…`. É edição mecânica, validada por dois gates: o build falha alto se algum
`require` não resolver, e o critério de aceite 2 (diff byte a byte de `public/`) prova que o bundle
final não mudou.

### 4.3 Registro

```
plugin/src/core/fontes/
├── index.js      # merge + validação + API pública
├── animes.js     # só as entradas da categoria
├── filmes.js
├── series.js     # module.exports = {}
└── doramas.js
```

- O caminho do arquivo é **derivado**: `src/scrapers/<plural(conteudos[0])>/<arquivo>`. O registro
  não guarda caminho, então `arquivo` e diretório não podem divergir.
- `plural`: `anime→animes`, `filme→filmes`, `serie→series`, `dorama→doramas`.
- `index.js` exporta exatamente o que `fontes.js` exporta hoje: `FONTES`, `CONTEUDOS`, `GRUPOS`,
  `chaves()`, `chavesTodos()`, `fontesDe()`, `fontesComIndice()`, `scrapers()`, `manifesto()`,
  `arquivoDe()`, `fonte()`. Acrescenta `porCategoria()` e `diretorioDe()`.
- Nenhum chamador muda: `build.js`, `tools/*` e `test/*` já usam `require("./src/core/fontes")`.

### 4.4 Ferramentas

```
plugin/tools/
├── medicao/       bateria  bateria-completa  casos  e2e-usuario  provar-links
│                  medir-rotas  monitorar-fontes  teste-rota-worker
├── validacao/     simular-sandbox  auditoria-contrato
└── publicacao/    gerar-indice  servidor-api
```

> **Desvio registrado (2026-10-08, na escrita do plano):** `teste-rota-worker.js` ficou em
> `medicao/` e não em `validacao/`. Ele faz probe de rede e importa `provar-links.js` por caminho
> relativo ao próprio diretório (`teste-rota-worker.js:38`); colocá-lo em `validacao/` criaria um
> require entre grupos. É medida, não validação offline.

`package.json`, `testes.yml`, `publicar-pages.yml` e `monitorar-fontes.yml` atualizados no mesmo
commit.

## 5. Efeito nas medições

`monitorar-fontes` e `bateria*` passam a agregar resultado **por categoria**
(`animes: 6/9 · filmes: 4/5 · doramas: 1/1`), além do agregado por fonte. É o modo como o dono
enxerga a saúde das fontes e prepara o sub-projeto B (motores por categoria).

Nenhuma medição deixa de rodar nem muda de semântica: só muda a dimensão de agrupamento.

## 6. Correções embutidas

| Problema | Onde hoje | Correção |
|---|---|---|
| `DESCRICAO_REPOSITORIO` diz "7 fontes" — são 10 ativas | `src/core/fontes.js` | descrição derivada de `chaves().length` |
| `deploy-workers.sh` promete ler `WORKERS` de `src/core/nomes.js` — arquivo inexistente, o script já não roda | `deploy-workers.sh:5` | lê `infra/workers/lista-workers.json` |
| Lista de workers só existe embutida em `tools/gerar-indice.js:29` (`blz, spc, ato`) e não tem relação com o que se publica | `plugin/tools/` | `lista-workers.json` vira a fonte de `gerar-indice.js` e de `deploy-workers.sh` |
| `plugin/CONTRATO.md:4` aponta para `estudos/nuvio-plugin-estudo.md` | caminho antigo | `docs/estudos/nuvio-plugin-estudo.md` |
| `publicar-pages.yml:46` valida `scrapers.length !== 7` | CI | valida contra o registro (`chaves().length`) |

Fora do escopo, sinalizado apenas: `.env.example` contém chave TMDB e credenciais Xtream em texto
puro — pertence ao plano `2026-10-03-3-seguranca.md`.

## 7. Erros e validação

Toda validação de estrutura falha **no build**, nunca em runtime, e acumula todos os problemas numa
única mensagem (padrão já usado por `confereRegistro()`), listando arquivo e regra violada.

Validações novas:

1. Para cada fonte, o arquivo existe exatamente em `src/scrapers/<plural(conteudos[0])>/`.
2. Nenhum `.js` em `src/scrapers/**` que não esteja no registro (estende a checagem plana atual).
3. Bijeção registro ↔ arquivo: sem fonte sem arquivo e sem arquivo sem fonte.
4. `conteudos[0]` existe em `CONTEUDOS`; demais `conteudos` também.
5. `series/` vazio é aceito — não é erro.
6. Nenhum workflow nem script referencia um path que não exista mais.

## 8. Testes

| Arquivo | O que trava |
|---|---|
| `test/categorias.test.js` (novo) | dir ≡ `plural(conteudos[0])`; sem órfãos; bijeção; `series/` aceito vazio |
| `test/registro.test.js` (novo) | API pública de `src/core/fontes/` idêntica (snapshot das chaves exportadas); `manifesto().scrapers.length === chaves().length` |
| `test/layout-repo.test.js` (novo) | arquivos movidos existem nos novos paths; nenhum path antigo referenciado |
| `test/runtime-aparelho.test.js` (existente) | continua verde — audit sandbox não muda |
| `test/http.test.js`, `id-de-conteudo.test.js`, `video-probe.test.js` (existentes) | inalterados |

Gate: `npm test` + `npm run sandbox` + `npm run build`. A prova de não-regressão de runtime é o
diff byte a byte de `plugin/public/`.

## 9. Fora de escopo

- Qualquer mudança de comportamento de scraping, timeout, retry ou cache (sub-projeto B).
- Motores/formalização de contrato de fonte (B).
- Endpoints HTTP, versionamento, OpenAPI (C).
- Documentação de desenvolvimento e guias (D).
- Auditoria multiplataforma além do que `runtime-aparelho.test.js` já cobre (E).
- Integração FenixFlix (descartada, decisão 1).
- Segurança de credenciais (plano existente `2026-10-03-3`).

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Mover `wrangler.toml` quebra o deploy dos workers | `infra/workers/` mantém `wrangler-*.toml` ao lado do código; `deploy-workers.sh` e workflows apontados e verificados por `test/layout-repo.test.js` |
| `public/` muda sem querer, quebrando o plugin instalado | critério de aceite 2: diff byte a byte é gate de aceite, não verificação manual |
| Caminhos relativos dentro dos scrapers (`../lib/`) quebram ao mover para subpasta | todos os 15 scrapers passam de 1 nível para 2; o build falha alto se algum `require` não resolver |
| `series.js` vazio esconde um erro de digitação em `conteudos` | validação 4 checa cada valor contra `CONTEUDOS` |
| A reescrita de ~87 `require` relativos erra algum arquivo | o `require` é resolvido pelo esbuild no `npm run build` — falha alto e aponta o arquivo; mais o gate byte a byte |

## 11. O que permanece intocado

- `plugin/src/core/politica.js` e seu `WORKER_POR_HOST` (host → URL do worker): é **runtime**,
  entram no bundle e não podem ler JSON de `infra/`. Continuam como estão; a consistência entre
  ele e `lista-workers.json` é responsabilidade do sub-projeto B, não desta reorganização.
- `plugin/src/lib/` — 18 arquivos, sem agrupamento (decisão 7).
- Qualquer lógica de scraping, timeout, retry, cache, qualidade ou probe.
- `docs/superpowers/{specs,plans}` — convenção dos artefatos de design, não muda de lugar.
