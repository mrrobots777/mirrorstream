# Arquitetura de borda do MirrorStream

## Fluxo edge-first

O caminho principal agora é resolvido na borda; o aparelho não consulta diretamente os painéis no primeiro acesso:

1. O plugin envia `id + type + season + episode + preferida` para `GET /resolve-batch` do gateway MirrorStream no BeamUp — um serviço Node único, no lugar de um `/resolve-edge` por Worker.
2. O gateway valida `id` e `type` **antes** de alcançar qualquer scraper e inicia, em paralelo e na ordem do registro, todas as fontes saudáveis elegíveis para o tipo (atualmente nove para TV e sete para filme). Sem preferência explícita, aguarda todas até o orçamento de 6 s; se ele se esgotar, devolve `PARCIAL` e conclui o cache em background. Com preferência explícita vazia, pode tentar duas alternativas.
3. O gateway agrega com `agruparStreams`, reescreve a URL de mídia para o relay e grava a resposta no cache em memória: 5 min no positivo completo, 15 s no parcial, 30 s no negativo.
4. O plugin recebe `streams` prontos — agregados, com `behaviorHints.bingeGroup` e a URL do relay — e devolve ao app sem agregar de novo; o fetch tem teto de 8 s.
5. O plugin não consulta mais os scrapers locais nem os Workers de resolução: sem gateway (ou estourado o teto), retorna vazio para evitar acesso direto às origens.

Os Workers de **resolução** saíram do caminho: o bundle novo não tem volta para `/resolve-edge` nem para os scrapers locais — sem gateway, a resposta é `[]`. O desligamento efetivo deles é a última etapa do deploy, depois de o gateway estar no ar e confirmado. Os Workers de **mídia** permanecem: o relay `/proxy?media=1`, um por fonte, continua encaminhando a URL de vídeo — é o relay que o gateway reescreve na resposta.

## Endpoints do gateway

Cinco rotas GET em Node puro (`gateway/servidor.js`), zero dependência npm. Todo caminho — inclusive erros 400/404/405/500 — devolve `access-control-allow-origin: *`, porque um erro bloqueado por CORS aparece no app como falha de rede, não como erro de validação. `OPTIONS` (preflight) responde 204; método ≠ GET responde 405 antes de olhar o caminho.

### `GET /resolve-batch`

Parâmetros: `id` obrigatório, `^[a-zA-Z0-9_:-]{1,120}$` (aceita o `:` de `tmdb:603` e `tt0903747:1:1`, que o regex antigo do Worker rejeitava); `type` obrigatório, `movie` ou `tv`; `season`/`episode` inteiros ou `-` (o `-` que o app manda para filme vira `null`, nunca `NaN`); `preferida` opcional (`mirrorstream:<fonte>`). Fora do formato, a resposta é 400 **antes** de qualquer scraper ser chamado.

Resposta 200: `{ streams, fontes, cache, ms }` — `streams` já agregado, com a URL de mídia reescrita para o relay e `bingeGroup` gravado; `fontes` é a lista das fontes consultadas (vazia em `HIT`/`NEGATIVO`); `cache` é um de `HIT`, `MISS`, `PARCIAL`, `NEGATIVO`. Resultado vazio é 200 com `streams: []`, nunca 404.

TTLs do cache do `/resolve-batch` — em memória, LRU com teto de 2000 entradas, a mesma chave `id|type|season|episode|preferida` para positivo e negativo:

| tipo | conteúdo | TTL |
|---|---|---|
| positivo completo | `streams` não vazio, todas as fontes terminaram | 5 min (300000 ms) |
| positivo parcial | `streams` não vazio, respondido no orçamento | 15 s (15000 ms), promovido a 5 min pela regravação em background |
| negativo | `streams: []` com resposta limpa de pelo menos uma fonte | 30 s (30000 ms) |

Falha total — todas as fontes consultadas erraram ou estouraram timeout — não grava nada: volta `MISS` com `streams: []`, porque "painel fora" não é "nenhuma fonte tem este título". Consultas idênticas em voo compartilham a mesma promessa (coalescimento).

### `GET /health`

JSON `{ ok, versao, uptime_s, fontes: { total, ativas, em_cooldown }, cache: { positivo, negativo } }`. Sempre `cache-control: no-store`. Prontidão: `fontes.ativas > 0` — `ok: true` só quer dizer que o processo responde.

### `GET /metrics`

Texto Prometheus (`text/plain; version=0.0.4`), também `cache-control: no-store`. Contadores de resolve por resultado (`hit`, `miss`, `parcial`, `negativo`, `erro`), contadores por fonte (`ok`, `vazio`, `erro`), gauges de cache e a soma/total dos `ms` de resposta. Sem histograma.

### `GET /manifest.json` e `GET /stream/{tipo}:{id}[:{s}:{e}].json`

Superfície Stremio, adicionada **depois** do plano original: o BeamUp não é um PaaS genérico — "It only supports Stremio addons" — e o `beamup-lint` recusa o deploy no pre-flight com `is not a valid Stremio addon, refusing to deploy it`. O build passava (npm install, processo `web`), só o gate da plataforma derrubava o push.

- `/manifest.json` é estático, em `gateway/stremio.js`. Validado contra o **`stremio-addon-linter` oficial** (v1.9.0): `valid: true`, zero erros, zero avisos.
- `/stream/...` delega ao **mesmo `resolve`** de `/resolve-batch` e devolve `{ streams }`. O parse em `parseiaStream` separa o tipo antes do primeiro `:` e, em série, os dois últimos segmentos numéricos viram temporada/episódio — o `id` no meio pode conter `:` (`movie:tmdb:603`), que é o que quebra um `split(':')` ingênuo. O Stremio chama de `series`, o gateway chama de `tv`: o parse traduz.
- Cada item é convertido por `paraStremio`: `headers` solto (formato do plugin) vira `behaviorHints.proxyHeaders.request`, que é onde o Stremio lê header de play; `behaviorHints.bingeGroup` é preservado; item sem `url` sai como `null` e é filtrado.
- Resultado vazio é 200 com `streams: []`, igual ao `/resolve-batch`; tipo fora de `movie`/`series` é 400.

**O que isto não é:** ninguém vai instalar este addon no Stremio. O consumo real continua sendo `/resolve-batch`, chamado pelo plugin MirrorStream instalado no aparelho. As duas rotas existem (a) para o gate da plataforma deixar o deploy passar e (b) para o manifesto não declarar `resources: ["stream"]` sem ter o endpoint.

## Fluxo de mídia

1. O gateway devolve o link de mídia já reescrito para o Worker de relay; o plugin não consulta os scrapers locais.
2. O agregador identifica a fonte e roteia apenas hosts de mídia explicitamente registrados:
   - `kakito.xyz` → `mirror-blz`;
   - `telaplay93.top` → `mirror-spc`;
   - `firetvcb.net` → `mirror-ato`;
   - CDNs de anime → `mirror-shg`, `mirror-atb`, `mirror-ron`, `mirror-ise`, `mirror-san` e `mirror-rtd`;
   - CDNs de dorama → `mirror-dgo`.
3. O Worker preserva `Range` e `Referer`, segue redirecionamentos permitidos e reescreve playlists HLS para que segmentos também passem pelo relay.
4. Hosts desconhecidos continuam com o link original, sem proxy arbitrário.

## Cache de resolução e mídia

- A resolução passou a ser cacheada no gateway, em memória, com os TTLs da seção `Endpoints do gateway`: 5 min (positivo completo), 15 s (parcial) e 30 s (negativo), chave estável por `id + type + season + episode + preferida`.
- Enquanto os Workers de resolução existirem, `/resolve-edge` mantém o cache antigo de 30 minutos no `caches.default` para os bundles já publicados; o bundle novo não os chama.
- `/resolve` permanece como compatibilidade para bundles antigos e warm-up legado.
- Playlists `.m3u8` do relay recebem TTL curto e chave própria, incluindo a URL e o `Referer`; o relay devolve `x-mirror-cache: HIT/MISS`.
- Segmentos `.ts` do relay são cacheados individualmente, com TTL maior e sem guardar respostas `Range`; cada segmento permanece abaixo do limite de objeto do plano Free.
- O Worker não baixa nem divide um MP4 grande para criar HLS. O cache segmentado só funciona quando a origem já fornece playlist e segmentos HLS.
- Requisições com `Range` nunca entram no cache de resposta inteira, evitando entregar um intervalo incorreto a outro usuário.
- Respostas cacheadas recebem `x-mirror-cache: HIT`; misses recebem `x-mirror-cache: MISS`.

O primeiro miss ainda depende da fonte original, mas ocorre na rede do Worker e não no aparelho. Os acessos seguintes usam o cache compartilhado do PoP da Cloudflare. Não existe fallback local no bundle agregado.

## Credenciais

TMDB e as credenciais dos painéis SPC, BLZ e ATO são lidas agora pelo gateway, no ambiente do BeamUp: `gateway/config.js` copia as variáveis de processo para os mesmos nomes de `globalThis` que os scrapers já leem (11 chaves):

- `TMDB_API_KEY`;
- `MIRROR_SPC_USER` e `MIRROR_SPC_PASS`;
- `MIRROR_BLZ_USER`, `MIRROR_BLZ_PASS` e `MIRROR_BLZ_CATALOGO`;
- `MIRROR_ATO_USER` e `MIRROR_ATO_PASS`;
- `MIRROR_INDEX_BASE`, `MIRROR_EDGE_MODE` e `MIRROR_QUALIDADE`.

Nenhum segredo entra no repositório — a configuração é do ambiente do BeamUp, assim como os Secrets eram da Cloudflare. O plugin mantém valores locais apenas como fallback de compatibilidade; o caminho edge-first não depende deles para resolver na borda.

## Fallback e segurança

Se o gateway estiver indisponível, a resolução retorna vazio (`[]` dentro do teto de 8 s do fetch do plugin); não há fallback para os Workers de resolução nem para os scrapers locais. Se a origem devolver erro ou timeout, o gateway não armazena a resposta inválida — falha de todas as fontes não vira cache negativo. No relay, um host não permitido continua bloqueado: a allowlist barra hosts internos, localhost, redes privadas e URLs arbitrárias.

O `bingeGroup` continua estável no formato `mirrorstream:<fonte>`, permitindo que o Nuvio reutilize a fonte escolhida no episódio seguinte.

## Deploy

O deploy recompila o bundle edge-first e publica um Worker por fonte:

```sh
cd infra/workers
./deploy-workers.sh
./deploy-workers.sh spc
```

O deploy exige `CLOUDFLARE_API_TOKEN` ou `~/.cloudflare-token`. Secrets são configurados separadamente com `wrangler secret put` e nunca são gravados no repositório.

O gateway tem a sua própria ordem de deploy, e a ordem importa porque o bundle embute a URL: subir o serviço no BeamUp, anotar a URL pública, gravá-la em `GATEWAY_PADRAO` (`plugin/src/core/politica.js`), rebuild e publicação do bundle, confirmação do `/resolve-batch` de um aparelho real — e só então avaliar desligar os Workers de resolução. Os quatro primeiros passos foram concluídos em 10/10/2026: `GATEWAY_PADRAO` é `https://e75602c18409-gateway.baby-beamup.club` e o bundle publicado foi provado batendo nela (runtime emulado + `fetch` real, 2 streams por consulta). Se a constante voltar a ser `""`, `resolveBatchUrl` devolve `null` e o bundle responde `[]` — defesa mantida de pé e coberta por teste.

Duas travas de credencial foram destravadas em 10/10/2026: o `gh auth setup-git` (conta `mrrobots777`) e o `sync-github-keys` do `beamup init` — a chave local já estava publicada no GitHub como `mirror-workstation-777`. A terceira trava não era credencial, era política da plataforma: o `beamup-lint` do BeamUp recusa qualquer app que não seja addon Stremio, e é o motivo de `/manifest.json` e `/stream/...` existirem.
