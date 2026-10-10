# Gateway MirrorStream no BeamUp — design

Data: 09/10/2026
Status: aprovado em conversa, aguardando revisão deste documento.

## 1. Contexto e objetivo

Hoje a resolução de streams do MirrorStream acontece em dois lugares:

1. `plugin/build.js` → `entradaAgregada()` gera o bundle `mirrorstream.js` que roda **no
   aparelho** e faz a orquestração: rodízio de 5 fontes por consulta, cache em memória,
   coalescimento, cooldown, preferência por `bingeGroup` e agregação.
2. Esse bundle chama **um Worker da Cloudflare por fonte** (`/resolve-edge`), servido por
   `infra/workers/edge-worker-entry.js`, que executa o scraper e guarda 30 minutos.

O objetivo é que o **BeamUp passe a ser o worker do plugin**: o aparelho não chama mais os
10 `mirror-*.workers.dev` para resolver; chama um único serviço Node no BeamUp. Os Workers
da Cloudflare ficam apenas como relay/cache de mídia (`/proxy?media=1`) e como borda de
cache do addon (`mirror-borda`).

Resultado esperado: uma URL de gateway embutida no plugin, um hop a menos por resolução,
cache compartilhado entre todos os aparelhos e os segredos dos painéis fora da Cloudflare.

## 2. Escopo

**Dentro**

- Serviço Node novo (`gateway/`) com `GET /resolve-batch`, `GET /health`, `GET /metrics`.
- Orquestração movida do bundle do aparelho para o servidor: prioridade por fonte, cache
  agregado, cache negativo, coalescimento, cooldown, orçamento de resposta.
- `plugin/` passa a ser cliente fino desse serviço.
- Testes do gateway e ajuste dos testes do plugin que cobrem o caminho removido.

**Fora**

- Relay de mídia: continua nos Workers (`MEDIA_WORKER_POR_HOST` em
  `plugin/src/core/politica.js`).
- Borda de cache do addon: `infra/workers/mirror-borda.mjs` não muda.
- Catálogo, meta e manifest: continuam no addon que já roda no BeamUp.
- Qualquer coisa no registro de fontes, nos scrapers ou na política de fontes.

## 3. Arquitetura e estrutura

```
Nuvio (bundle mirrorstream.js)
  │  GET /resolve-batch?id=…&type=…
  ▼
Gateway MirrorStream — BeamUp, Node 18+, zero dependência npm
  ├── fontes.js     registro (plugin/src/core/fontes) + require dos scrapers
  ├── resolve.js    prioridade, orçamento, enriquecimento, agregação
  ├── cache.js      positivo + negativo + coalescimento + LRU
  ├── estado.js     cooldown por fonte (falhas, `ate`, candidatas)
  ├── metricas.js   contadores → /metrics
  ├── config.js     process.env → globalThis (mesmos nomes de hoje)
  └── servidor.js   http puro, 3 rotas, CORS, timeout
```

Diretório novo na raiz. `plugin/test/layout-repo.test.js` só vigia `plugin/tools/**`, então
não conflita.

O serviço **não tem dependência npm**: nenhuma fonte importa `cheerio` ou `crypto-js`
(verificado por grep em `plugin/` — só `build.js`, o simulador e um teste os citam) e o
parser de HTML é `plugin/src/lib/html.js`, próprio. O único requisito de runtime é `fetch`,
nativo desde o Node 18.

Reuso, sem cópia: `plugin/src/core/fontes` (registro, `ORDEM`, `chaves()`, `fontesDe()`),
`plugin/src/lib/agregador` (`agruparStreams`), `plugin/src/lib/qualifica` (`qualificaLista`)
e os scrapers em `plugin/src/scrapers/**`.

## 4. Contrato HTTP

### `GET /resolve-batch`

Parâmetros de query:

| nome | obrigatório | formato |
|---|---|---|
| `id` | sim | `^[a-zA-Z0-9_:-]{1,120}$` |
| `type` | sim | `movie` ou `tv` |
| `season` | para `tv` | inteiro ou `-` |
| `episode` | para `tv` | inteiro ou `-` |
| `preferida` | não | `mirrorstream:<fonte>` |

O `id` **aceita `:`**, porque os formatos que chegam em `getStreams` são `tt0133093`,
`tt0903747:1:1`, `603` e `tmdb:603` (documentados em `plugin/src/lib/id-de-conteudo.js`).
Isso é diferente do Worker atual: `infra/workers/edge-worker-entry.js:81` valida com
`^[a-zA-Z0-9_-]{2,120}$`, que **rejeita `tmdb:603` e `tt0903747:1:1` com 400**. O gateway
não herda esse defeito.

Resposta **200**:

```json
{
  "streams": [ { "url": "…", "title": "…", "name": "☁️ MirrorStream · …",
                 "provider": "☁️ MirrorStream",
                 "behaviorHints": { "bingeGroup": "mirrorstream:spc" } } ],
  "fontes": ["spc", "blz"],
  "cache": "MISS",
  "ms": 812
}
```

- `streams` chega **agrupado e com a URL de mídia já reescrita para o relay**: é a saída
  de `agruparStreams()`, que aplica `mediaWorkerDe()` na linha 64 e grava o `bingeGroup`.
  O aparelho devolve a lista como está.
- `fontes` — ids das fontes **consultadas**, na ordem de prioridade, incluindo a onda de
  reserva quando ela roda. É `[]` em `HIT` e em `NEGATIVO`, porque nenhuma fonte foi
  chamada.
- `cache` — um de `HIT` (cache positivo completo), `MISS` (calculado e completo),
  `PARCIAL` (calculado, respondido no orçamento antes de todas as fontes terminarem),
  `NEGATIVO` (cache negativo).
- `ms` — tempo total da resposta, em milissegundos.

Erros:

| caso | status | corpo |
|---|---|---|
| método diferente de GET | 405 | `{ "erro": "metodo" }` |
| `OPTIONS` (preflight) | 204 | vazio, com CORS |
| `id` fora do formato | 400 | `{ "erro": "id invalido" }` |
| `type` fora de `movie`/`tv` | 400 | `{ "erro": "type invalido" }` |
| exceção não tratada | 500 | `{ "erro": "interno" }` |

Todas as respostas, **inclusive os erros**, levam
`access-control-allow-origin: *` — um 400 bloqueado por CORS aparece no app como falha de
rede, não como erro de validação.

**Resultado vazio é 200 com `streams: []`**, nunca 404 — é essa a condição que o cache
negativo guarda. O aparelho trata qualquer status fora de 200, e qualquer falha de parse,
como lista vazia.

### `GET /health`

```json
{ "ok": true, "versao": "1.0.0", "uptime_s": 1234,
  "fontes": { "total": 10, "ativas": 9, "em_cooldown": 0 },
  "cache": { "positivo": 12, "negativo": 3 } }
```

`total` é o tamanho do registro; `ativas` é quantas carregaram no boot (a diferença é
scrapers que falharam ao `require`). `em_cooldown` é um subconjunto de `ativas`, não de
`total`.

Sempre `cache-control: no-store`. `ok` é `true` enquanto o processo responde; a leitura de
prontidão é `fontes.ativas > 0`.

### `GET /metrics`

Texto Prometheus (`content-type: text/plain; version=0.0.4; charset=utf-8`),
`cache-control: no-store`. Contadores e gauges, sem histograma:

```
gateway_up 1
gateway_fontes_total 10
gateway_fontes_ativas 9
gateway_fontes_em_cooldown 0
gateway_cache_entradas{tipo="positivo"} 12
gateway_cache_entradas{tipo="negativo"} 3
gateway_resolve_total{cache="hit"} 41
gateway_resolve_total{cache="miss"} 7
gateway_resolve_total{cache="parcial"} 3
gateway_resolve_total{cache="negativo"} 18
gateway_resolve_total{cache="erro"} 0
gateway_fonte_total{fonte="spc",resultado="ok"} 120
gateway_fonte_total{fonte="spc",resultado="vazio"} 40
gateway_fonte_total{fonte="spc",resultado="erro"} 2
gateway_resposta_ms_soma 184230
gateway_resposta_ms_total 109
```

## 5. Orquestração

### Seleção e prioridade

A ordem é **`preferida` → saudável → `ORDEM` do registro**. O rodízio (`cursorRodazio` em
`build.js`) é removido: ele existe para distribuir carga entre aparelhos, e no servidor
essa imprevisibilidade não paga nada — o cache compartilhado já absorve a concentração.

- **Onda principal sem preferência:** todas as fontes saudáveis elegíveis, na ordem acima,
  disparadas em paralelo. Elegível é `!f.tipos.length || f.tipos.includes(type)`, a mesma
  regra de `elegiveisDe()`. No registro atual isso representa 9 fontes para `tv` e 7 para
  `movie`; uma fonte incompatível com o tipo nunca é chamada.
- **`preferida` presente e elegível:** a onda principal é **só** ela (regra de
  `consultar()` hoje). Se ela devolver vazio, reserva de **2** fontes seguintes
  (`MAX_FONTES_FALLBACK_PREFERIDA`).
- **`preferida` ausente, inexistente no registro ou de tipo incompatível:** é ignorada e a
  consulta segue como se não viesse — uma fonte desligada não pode transformar a
  resolução em vazio.
- Sem preferência, não há segunda onda: todas as fontes elegíveis já foram chamadas.

### Orçamento

| constante | valor | origem |
|---|---|---|
| orçamento da resposta | **6000 ms** (env `MIRROR_ORCA_MS`, limitado a 1000–9000) | novo; o addon no Nuvio tem teto de 9 s |
| timeout por fonte | 8000 ms | `TIMEOUT_FONTE` atual |
| teto do `qualificaLista` | 5000 ms por lista | `detalhar` atual |

O gateway aguarda todas as tarefas já disparadas até completar ou esgotar o orçamento; não
retorna mais 700 ms após o primeiro player. O aparelho espera no máximo 8000 ms pelo `fetch`
do gateway. Se o orçamento acabar antes de uma fonte lenta, a resposta é `PARCIAL` e o cache
é promovido quando as tarefas terminarem.

### Fluxo de uma consulta

1. Verifica cache positivo → `HIT` e sai.
2. Verifica cache negativo → `NEGATIVO` e sai.
3. Entra na fila de coalescimento: se já existe uma consulta idêntica em voo, reusa a
   mesma promessa.
4. Dispara a onda principal: todas as elegíveis sem preferência ou somente a preferida.
   Cada tarefa: `getStreams()` do scraper → `qualificaLista()` com teto de 5 s → marca
   `__mirrorSource`.
5. Espera todas as tarefas ou o orçamento restante, sem corte após o primeiro resultado.
6. `agruparStreams()` sobre as listas recebidas → resposta (`MISS` ou `PARCIAL`).
7. Se uma `preferida` válida ficou vazia e ainda há orçamento, dispara até **2** fontes de
   reserva e repete o passo 5. Sem preferência, todas já foram consultadas.
8. Em background, quando todas as tarefas terminarem, regrava o cache com o resultado
   completo — é o upgrade `PARCIAL → HIT` da próxima chamada.

### Enriquecimento

`qualificaLista()` roda dentro da tarefa da fonte, com teto de 5 s — idêntico ao `detalhar`
de hoje (`MIRROR_QUALIDADE !== "nunca"`).
`MIRROR_QUALIDADE=nunca` desliga a sondagem de vídeo, como hoje.

## 6. Caches

Chave única para positivo e negativo:

```
id | type | season | episode | preferida
```

| tipo | conteúdo | TTL |
|---|---|---|
| positivo completo | `streams.length > 0`, todas as fontes terminaram | 300000 ms (5 min) |
| positivo parcial | `streams.length > 0`, respondido no orçamento | 15000 ms |
| negativo | `streams.length === 0` | 30000 ms |

- **Coalescimento:** mapa de promessas em voo por chave; a entrada sai em `finally`.
- **LRU:** teto de **2000 entradas** por cache, com expulsão da entrada mais antiga.
  Atingir o teto não é erro — é o projeto.
- Cache em memória do processo, sem disco e sem Redis: o processo do BeamUp é um só, e
  um cache perdido no restart é um miss, não uma indisponibilidade.

O negativo passa de 3 s (valor atual no aparelho) para 30 s: segura um painel fora do ar
sem enterrar uma fonte que voltou. Se a fonte voltar antes, o próximo deploy/`/health`
não muda nada — o TTL é a única correção, e ela expira sozinha.

**Exceção — falha total não vira negativo.** Se *todas* as fontes consultadas **falharam**
(exceção ou timeout) e nenhuma respondeu com sucesso, devolve `streams: []` com
`cache: "MISS"` e **não grava nada**. Só uma consulta em que ao menos uma fonte respondeu
limpamente pode guardar o vazio como negativo. É o que reconcilia §6 (negativo =
`streams.length === 0`) com §9 (resposta inválida nunca é guardada): "nenhuma fonte tem
este título" é cacheado, "os painéis estão fora" não.

## 7. Estado por fonte

- Falha de rede, exceção do scraper ou timeout → `falhas++`.
- `falhas >= 3` → `ate = agora + 60000` (`COOLDOWN_FONTE` atual).
- Sucesso → `falhas = 0`.
- Fonte em cooldown **não entra na seleção**, a menos que não haja nenhuma saudável —
  nesse caso todas voltam a ser candidatas (mesma regra de `selecionaFontes()`).
- Estado em memória, por processo. Reinício zera as falhas; é aceitável, porque o cooldown
  protege contra uma origem ruim, não contra histórico.

`em_cooldown` aparece em `/health` e como gauge em `/metrics`.

## 8. Configuração e segredos

`config.js` copia `process.env` para os mesmos `globalThis.*` que os scrapers já leem —
é a mesma lista de `edge-worker-entry.js:102-108`, só muda o lugar (CF Secrets →
ambiente do BeamUp):

```
TMDB_API_KEY
MIRROR_SPC_USER   MIRROR_SPC_PASS
MIRROR_BLZ_USER   MIRROR_BLZ_PASS   MIRROR_BLZ_CATALOGO
MIRROR_ATO_USER   MIRROR_ATO_PASS
MIRROR_INDEX_BASE
MIRROR_EDGE_MODE   (nunca pode ser "nunca" — é o que liga mediaWorkerDe)
MIRROR_QUALIDADE
MIRROR_GATEWAY    (override em globalThis, para teste; o valor de produção é a
                   constante GATEWAY_PADRAO gravada no politica.js no passo 3 do deploy)
PORT               (padrão 7000)
MIRROR_ORCA_MS     (padrão 6000)
```

Segredos vão pelo ambiente do BeamUp. Nenhum entra no repositório.

## 9. Queda e limites

- Gateway fora → o plugin devolve `[]`. É o comportamento atual quando os Workers não
  respondem.
- **Sem fallback** para Workers de resolução e sem retorno aos scrapers locais: "somente
  o gateway".
- Fonte com erro não contamina a resposta: sua lista vira `[]` e as outras seguem.
- O gateway não guarda resposta de fonte com status ≥ 400 (regra de `deixaGuardar`).
- Allowlist de hosts permanece a de `plugin/src/lib/http.js`; o gateway não abre proxy
  arbitrário e não expõe rota de mídia.

## 10. Mudanças no plugin

**`plugin/src/core/politica.js`**

- `GATEWAY_BASE` resolvido nesta ordem: `globalThis.MIRROR_GATEWAY` → constante
  `GATEWAY_PADRAO` deste arquivo.
  **Não existe leitura de `process.env` aqui de propósito:** `plugin/src/**` é bundlado para
  o aparelho, e tanto `simular-sandbox.js:195` quanto `runtime-aparelho.test.js:28` reprovam
  o token `process.env` com regex — a leitura quebraria o build do bundle, não só o teste.
  A URL é gravada em `GATEWAY_PADRAO` **depois** que o serviço estiver no ar — ver §12.
  Sem URL, `resolveBatchUrl()` devolve `null` e o bundle responde `[]`, que é a queda já
  definida em §9.
- Entram: `resolveBatchUrl(args, preferida)`.
- Saem de uso: `edgeResolverDe`, `resolveWorkerDe`, `RESOLVE_WORKER_POR_FONTE` e
  `aqueceCacheResolucao` (o warm-up não faz sentido: o cache agora é do servidor).
- Seguem: `WORKER_POR_HOST`, `MEDIA_WORKER_POR_HOST`, `workerDe`, `mediaWorkerDe`,
  `chaveResolucao`, `deveTentarEdge` — o `workerDe` é usado pelo `src/lib/http.js` dos
  scrapers, que rodam dentro do gateway.

**`plugin/build.js` → `entradaAgregada()`**

Vira cliente fino:

```
getStreams(...args) → resolveBatchUrl → fetch com teto de 8000 ms → body.streams
```

Saem do bundle gerado: `CACHE`, `INFLIGHT`, `ESTADO_FONTES`, `LOCKS_FONTES`,
`cursorRodizio`, `selecionaFontes`, `chamaFonte`, `consultar`, `preferenciaDe`,
`agruparStreams` e `qualificaLista` — tudo isso passa a viver no servidor. `preferenciaDe`
continua sendo traduzido **no aparelho** para o parâmetro `preferida`, porque é o
`bingeGroup` que o Nuvio repassa no `getStreams`.

O `dist/mirrorstream.js` continua sendo gerado, ofuscado e publicado como hoje.

**Testes afetados** (trabalho previsto, não opcional): só
`plugin/test/media-edge.test.js` — ele cobre `edgeResolverDe`, `resolveWorkerDe` e
`chaveResolucao`. `chaveResolucao` permanece; os outros dois casos são reescritos para o
contrato novo.

Verificado por grep: `tools/medicao/*` **não** usa as funções de resolução.
`medir-rotas.js` importa `WORKER_POR_HOST`/`workerDe` (caminho de API, que continua) e
`teste-rota-worker.js` tem a URL do relay hardcoded — os dois continuam como estão.

## 11. Testes e critérios de aceite

`gateway/test/*.test.js` com `node --test`, `fetch` mockado, **sem rede**. O `npm test` do
plugin continua sendo exigido para passar.

Casos obrigatórios:

1. Ordem de prioridade: `preferida` → saudável → `ORDEM`.
2. Busca padrão chama todas as fontes elegíveis (9 para `tv`, 7 para `movie`) e espera até
   concluir ou esgotar o orçamento; não há reserva padrão nem corte após o primeiro resultado.
3. `preferida` sozinha na onda, reserva de 2 quando ela falha, e `preferida` inexistente ou
   de tipo incompatível sendo ignorada.
4. Cache positivo completo → `HIT`, sem nova chamada de scraper.
5. Resultado vazio guardado → `NEGATIVO` nas chamadas seguintes, até expirar.
6. Duas requisições idênticas simultâneas → um único `getStreams` por fonte.
7. Fonte lenta além do orçamento → `PARCIAL`, e o cache é regravado completo depois.
8. 3 falhas na mesma fonte → ela sai da seleção por 60 s e volta a aparecer em
   `em_cooldown`.
9. `id` malformado → 400; resultado vazio → 200 com `[]`.
10. `/health` **com** `cache-control: no-store`, e `/metrics` no formato Prometheus.
11. `agruparStreams()` devolve a URL já no relay e o `bingeGroup` correto.
12. O boot carrega todos os scrapers do registro — qualquer API browser-only que falhe no
    Node derruba este teste, não a produção.

Aceite do conjunto: `npm test` (plugin) + `node --test gateway/test` verdes, e o serviço
subindo localmente respondendo os três endpoints.

## 12. Deploy

Ordem importa — o plugin embute a URL, então a URL tem de existir antes do bundle:

1. Cadastrar a chave SSH no BeamUp (ação do dono, fora deste trabalho).
2. Subir o serviço no BeamUp e anotar a URL pública.
3. Gravar essa URL em `GATEWAY_PADRAO` (`plugin/src/core/politica.js`).
4. `npm run build` e publicar o bundle.
5. Confirmar `/resolve-batch` de um aparelho real.
6. Só então avaliar desligar os Workers de resolução — os de mídia permanecem.

Itens em aberto, que dependem de acesso ao BeamUp e por isso não estão resolvidos aqui:

- **App novo ou endpoints no addon que já rola lá**
  (`e75602c18409-mirrorstream.baby-beamup.club`). Um app novo é preferível: porta e
  processo próprios, deploy separado do addon, e um restart do gateway não derruba o
  catálogo. A decisão fica para quando a credencial existir, porque é lá que se vê o que
  já está no ar.
- Forma de deploy do BeamUp (o host mencionado é `deployer.beamup.dev`).

## 13. Decisões registradas

| decisão | escolhido | descartado | por quê |
|---|---|---|---|
| contrato do lote | 1 id, N fontes | lote de vários ids | o Nuvio pede um `getStreams` por vez; ninguém precisaria de ids múltiplos |
| onde rodam os scrapers | Node no BeamUp | gateway fino repassando para os Workers | era o objetivo declarado; repassar deixa os scrapers na Cloudflare |
| base do serviço | novo `gateway/` | adaptar `tools/publicacao/servidor-api.js` | é ferramenta de dev, sem cache/negativo/cooldown, e depende do build antes de subir |
| ordem das fontes | preferida → saudável → `ORDEM` | rodízio atual | previsibilidade no servidor vale mais que sorteio |
| reescrita da URL de mídia | no gateway, reaproveitando `agruparStreams` | no aparelho, via `mediaWorkerDe` | mudanca de relay passa a valer por deploy do gateway, sem republicar o bundle |
| negativo | 30 s | 3 s (atual) | 3 s não segura painel fora do ar; 30 s não enterra fonte que voltou |
| formato do `/metrics` | texto Prometheus | JSON | formato padrão, trivial de consumir, sem dependência |
| cache | em memória | disco/Redis | um miss pós-restart não é indisponibilidade |
| fallback do plugin | nenhum | Workers de resolução / scrapers locais | "somente o gateway", decisão do dono |

## 14. Riscos

- **APIs de navegador nos scrapers.** Eles foram escritos para o runtime do aparelho.
  Toda API que não existir no Node estoura no boot. Mitigação: `fontes.js` exige todos os
  scrapers na subida, o teste de subida cobre esse `require`, e `/health` reporta
  `fontes.ativas` para o caso de falha em produção.
- **Fan-out para os painéis.** Uma onda de 5 + reserva de 5 é mais requisição que o
  aparelho fazia, mas o cache agregado e o negativo concentram o custo no servidor e o
  dividem entre todos os aparelhos. O orçamento de 6 s segura a resposta.
- **Corte seco.** O bundle novo não tem caminho de volta aos Workers. Se o gateway subir
  quebrado, o plugin devolve vazio. Por isso a ordem da §12: subir, conferir, *então*
  publicar o bundle.
- **Estado por processo.** Duas instâncias teriam caches e cooldowns independentes. Hoje o
  BeamUp roda um processo; se isso mudar, cada um continua correto, só menos eficiente.

## 15. Observação à parte

`.env.example` contém o que parecem ser credenciais reais (`TMDB_API_KEY`, `IPTV_PASSWORD`,
`XTREAM_SPACE_PASS`) versionadas na raiz. Fora do escopo deste design, mas coberto pelo
`SECURITY.md` e vale revisar antes de qualquer publicação.
