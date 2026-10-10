# Estudo: plugin Nuvio para o Mirror

> Pesquisa somente-leitura nos repositórios **oficiais** (`NuvioMedia/*`), branch por branch:
> `NuvioMobile` @ `cmp-rewrite` (runtime mobile/QuickJS), `NuvioTV` @ `dev` (Android TV),
> `NuvioTVSmart` @ `main` (webOS/Tizen, JS), `NuvioDesktop` @ `Dev` (alfa).
> Cada achado cita arquivo + linha. Onde não achei, está escrito "não achei".
> Nenhum repositório foi modificado; este arquivo é o único artefato gravado.

---

## 1. Contrato do provider (`getStreams`)

- **Assinatura:** `getStreams(tmdbId, mediaType, season, episode)` — async, em `module.exports.getStreams`
  **ou** global `getThreads`/`globalThis.getStreams` (descoberta em
  `mobile/composeApp/src/fullCommonMain/.../runtime/js/JsBindings.kt:31-40`).
- **Argumentos** (`JsBindings.kt:37-40`; montados em
  `mobile/composeApp/src/fullCommonMain/.../runtime/PluginRuntime.kt:136-143`): só
  `tmdbId` (string), `mediaType`, `season` (int|null), `episode` (int|null). **Nada mais.**
- **`mediaType` é normalizado para `"tv"`** — nunca chega `"series"`:
  `normalizePluginType` mapeia `series/show/other → tv`
  (`mobile/composeApp/src/commonMain/.../plugins/PluginModels.kt:214-218`); no Android TV,
  `normalizeTmdbPluginType` faz o mesmo (`tv/app/src/main/java/.../data/repository/StreamRepositoryImpl.kt:381-386`).
- **`tmdbId` vem pré-resolvido:** o app passa o id **sem prefixo e sem sufixo de episódio**
  (`pluginContentId` remove `tmdb:` e `:temp:ep` — `mobile/composeApp/src/commonMain/.../plugins/PluginContentIds.kt`),
  e `resolvePluginTmdbId` converte `tt…` (IMDb) para TMDB antes de chamar
  (`mobile/composeApp/src/fullCommonMain/.../plugins/PluginRepository.kt:374-403` →
  `mobile/composeApp/src/commonMain/.../tmdb/TmdbService.kt:18-45`). Se não houver conversão
  (ex.: `kitsu:123` sem par TMDB), o **id cru** vai para o plugin.
- **Retorno:** array de objetos; cada item parseado com
  `url` (obrigatório — sem ele o item é descartado), `title` (fallback `name`), `name`,
  `quality`, `size` (**string**), `language`, `provider`, `type`, `seeders`, `peers`,
  `infoHash`, `headers` (map), `subtitles[]` `{url, language, name, headers}`
  (`PluginRuntime.kt:196-249`). `url` pode ser string **ou** objeto `{url: …}` (`PluginRuntime.kt:201-205`).
- **Erro/ausência → `[]` silencioso** (`JsBindings.kt:42-45`); exceção do plugin nunca derruba o app.
- **Exemplo oficial de teste:** `testScraper` chama com `tmdbId = "603"` (Matrix),
  `season/episode = 1` quando o scraper é de TV
  (`PluginRepository.kt:333-349`).
- **Hook opcional `onSettings()`** devolve o layout das configurações do scraper
  (`JsBindings.kt:49-64`).

## 2. Globais disponíveis no sandbox

| recurso | SIM/NÃO | prova (arquivo:linha) |
|---|---|---|
| `fetch` | **SIM** — `fetch(url, {method, headers, body, redirect})`; aceita **headers arbitrários** (objeto/Headers/array), então `Range` funciona; corpo aceite string/ArrayBuffer/bytes | `JsBindings.kt:126-221` (normaliza headers em 127-142) |
| resposta do fetch | **bytes**: `arrayBuffer()`, `text()`, `json()`, `status`, `ok`, `headers.get()` | `JsBindings.kt:194-220` |
| corpo da resposta (teto) | **1 MB** — `DefaultRawHttpResponseMaxBytes = 1024 * 1024`, comentário: *"for generic and plugin-provided HTTP responses"*; leitura cortada com `readAtMostBytes` | `mobile/composeApp/src/commonMain/.../addons/AddonPlatform.kt:21` + `AddonPlatform.android.kt:312` |
| header de resposta | valor truncado em 8 KB | `FetchBridge.kt:16` |
| UA padrão do fetch | browser Chrome, se não passar `User-Agent` | `FetchBridge.kt:61-63` |
| proxy do Nuvio | **NÃO** — é HTTP direto do aparelho (OkHttp `Proxy.NO_PROXY`); a origem vê o IP do usuário | `AddonPlatform.android.kt:112` e `tv/app/src/full/.../plugin/PluginRuntime.kt:56` |
| `localStorage`/storage gravável pelo JS | **NÃO** — não existe binding de storage (lista completa de bindings abaixo). O plugin **não** persiste dados por conta própria | binding list, ver §9 |
| `crypto.subtle` + `CryptoJS` | **SIM** — digest (MD5/SHA-1/256/384/512), HMAC, AES-CBC/GCM/ECB, PBKDF2, `getRandomValues`, `randomUUID` | `JsBindings.kt:367-895` (bridges nativos: `CryptoBridge`) |
| `URL` / `URLSearchParams` | **SIM** (polyfill completo) | `JsBindings.kt:292-365` |
| `atob`/`btoa` | **SIM** | `JsBindings.kt:257-290` |
| `TextEncoder`/`TextDecoder` | **SIM** | `JsBindings.kt:897-921` |
| `Uint8Array`/`ArrayBuffer` | **SIM** (built-in do QuickJS; o fetch os usa diretamente) | `JsBindings.kt:173-177,204-207` |
| `cheerio` | **SIM** — global **e** via `require("cheerio")` | `JsBindings.kt:923-1056`, require em 1057-1067 |
| `require` | **só** `cheerio`/`cheerio-without-node-native`/`react-native-cheerio` e `crypto-js`; resto → throw | `JsBindings.kt:1057-1067` |
| `console.*` | **SIM** (vai para o log do app com a tag `Plugin:<id>`) | `HostFunctions.kt:31-52` |
| `setTimeout/setInterval` | **SIM**, atraso **máx. 60 000 ms** por timer | `JsBindings.kt:66-124` (clamp na linha 74), `HostFunctions.kt:11,22-29` |
| `AbortController` | **SIM** (polyfill — mas não cancela a rede nativa de verdade) | `JsBindings.kt:224-255` |
| `WebAssembly` | **PLACEHOLDER MORTO** — `instantiate` loga aviso e devolve `exports: {}` | `JsBindings.kt:888-894` |
| `TMDB_API_KEY` | **SIM** — global injetada (ver §7) | `JsBindings.kt:7-9` |
| `SCRAPER_ID` / `SCRAPER_SETTINGS` | **SIM** — ids/configs do scraper (ver §9) | `JsBindings.kt:5-6` |
| Node (`fs`, `http`, `process`) | **NÃO** | não existe binding algum |
| **tempo de execução** | **60 s** por invocação (`PLUGIN_TIMEOUT_MS`), **10** invocações simultâneas (`MAX_CONCURRENT_PLUGINS`) | `PluginRuntime.kt:40-41` |
| tempo de um HTTP dentro do plugin | OkHttp 60 s connect/read/write (mas o orçamento total é 60 s) | `AddonPlatform.android.kt:105-107` |

**Lista completa de bindings host (nada além disso existe):** `__plugin_sleep`, `console`,
`__get_scraper_id`, `__get_scraper_settings`, `__get_tmdb_api_key`, `__get_call_args`,
`__capture_result` (`HostFunctions.kt:54-61`), `__native_fetch` (`FetchBridge.kt:24`),
`__parse_url` (`UrlBridge`), `__crypto_*` (`CryptoBridge`), `__cheerio_*` (`DomBridge`),
`__native_wasm_instantiate` (`WasmBridge`) — varredura por `runtime.function(`/`asyncFunction(`/`define(` em `.../plugins/runtime/`.

## 3. LIVE TV — **NÃO por plugin** (com prova)

**Resposta: canal ao vivo não se entrega por plugin.** Três provas independentes:

1. **Plugin só devolve stream de um id que o app já tem** — não existe `getCatalog`/`getMeta`/EPG
   no contrato (§1). Não há como um plugin **criar** canal, lista de canais ou guia.
2. **NuvioTV (Android TV) bloqueia explicitamente:** `buildPluginRequest` só monta chamada de
   plugin se houver `tmdbId` **ou** o id começar com `kitsu:`/`anilist:`/`mal:` —
   `canRunLocalPlugins()` (`StreamRepositoryImpl.kt:359-376` e `432-435`). Id de canal não é
   nenhum dos três → retorna `null` → plugin nunca roda.
3. **Mobile tem teste travando isso:** `assertFalse(available(plugins = plugins, type = "channel"))`
   (`mobile/composeApp/src/commonTest/.../streams/PlaybackAvailabilityTest.kt:40`; a lógica é
   `PlaybackAvailability.kt:29` — plugin só conta se `supportsType(type)`).

**O que é "vivo" no Nuvio:** o tipo é o **`channel`** do Stremio — *"plus the Stremio catalog type
`channel`"* e *"Do not treat `tv` as live: in this app it is the series synonym"*
(`tv/app/src/main/java/.../ui/screens/player/LivePlaybackUiPolicy.kt:7-13`).

**De onde vem a lista de canais hoje:** de **addons Stremio-compatíveis instalados**, mesmo
transporte de sempre — `buildAddonResourceUrl` monta `"{base}/{resource}/{type}/{id}.json"`, ou
seja `/stream/channel/<id>.json`, e o manifesto de addon aceita a lista `types`
(`mobile/composeApp/src/commonMain/.../addons/AddonTransportUrls.kt:6-24`,
`AddonManifestParser.kt:26`). O Nuvio **não tem catálogo de canais próprio**.

**Consequência para o Mirror:** Live TV (REI/EMB/ETC + EPG) **não migra para plugin Nuvio**.
Se quisermos Nuvio, o plugin Nuvio cobre VOD/anime (os scrapers `getStreams`), e a TV teria de
continuar como addon Stremio (o formato que o Nuvio já entende) ou ficar de fora.

## 4. Schema do `manifest.json`

**Repositório** (`PluginManifest`, `PluginModels.kt:14-21`) — obrigatório: `name`, `version`,
`scrapers` não-vazio (`PluginManifestParser.kt:17-28` faz `require` dos três). Opcionais:
`description`, `author`.

**Cada scraper** (`PluginManifestScraper`, `PluginModels.kt:23-41`) — obrigatórios: `id`, `name`,
`version`, `filename`. Opcionais/com default: `description`, `supportedTypes` (default
`["movie","tv"]`), `enabled` (default `true`), `hasSettings`, `logo`, `contentLanguage`,
`supportedPlatforms`, `disabledPlatforms`, `formats`/`supportedFormats`,
`supportsExternalPlayer`, `limited`.

**Exemplo mínimo:**

```json
{
  "name": "Mirror",
  "version": "1.0.0",
  "description": "Anime, filmes, séries e doramas",
  "scrapers": [
    { "id": "mirror", "name": "Mirror", "version": "1.0.0",
      "filename": "mirror.js", "supportedTypes": ["movie", "tv"] }
  ]
}
```

**Como o app busca/atualiza:**

- URL digitada é normalizada: se não termina em `/manifest.json`, o sufixo é **anexado**
  (`PluginRepository.kt:643,659`); o código vai para `baseUrl + "/" + filename` (relativo) ou URL
  absoluta http(s) (`PluginRepository.kt:413,418-422`).
- **id interno do scraper** = `` `${manifestUrl.lowercase()}:${id}` `` (`PluginRepository.kt:425`).
- Fetch por `httpGetText` (`PluginRepository.kt:411`) — `readResponseBody` **sem teto de bytes**
  no mobile (`AddonPlatform.android.kt:177-185`); no Android TV o download de código é limitado a
  **5 MB** (`tv/app/src/full/.../plugin/PluginManager.kt:54,990`).
- **Refresh: 6 h** — `PLUGIN_REPOSITORY_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1_000`
  (`PluginModels.kt:6-11`).
- **Sync com Supabase** (`postgrest` + RPC `sync_push_plugins` — `PluginRepository.kt:123,521`).
- Código fica **cacheado em disco** por perfil (`saveScraperCode`, `PluginRepository.kt:426-434`;
  store em `androidFull/.../PluginPlatform.android.kt:14-40`) — sobrevive a restart.
- Filtro por plataforma: `isSupportedOnCurrentPlatform()` (`PluginRepository.kt:416`).

## 5. Limites de plataforma — quem roda plugin

**Dobro trava na loja (confirmado):** build de loja = `AppFeaturePolicy.pluginsEnabled = false`
**e** `PluginRepository` substituído por stub (`AddPluginRepositoryResult.Error`):

| build | pluginsEnabled | prova |
|---|---|---|
| Android sideload (`androidFull`) | **true** | `androidFull/.../AppFeaturePolicy.android.kt:4` |
| Android Play Store (`androidPlaystore`) | **false** + stub | `androidPlaystore/.../AppFeaturePolicy.android.kt:4`; `androidPlaystore/.../PluginRepository.android.kt:10-24` |
| iOS sideload (`iosFull`) | **true** | `iosFull/.../AppFeaturePolicy.ios.kt:4` |
| iOS App Store (`iosAppStore`) | **false** + stub | `iosAppStore/.../AppFeaturePolicy.ios.kt:4`; `iosAppStore/.../PluginRepository.ios.kt:10-24` |
| Desktop (`desktopMain`) | **false** | `desktopMain/.../AppFeaturePolicy.desktop.kt:4` |
| Android TV — flavor `full` | **sim** (PluginManager real) | `tv/app/src/full/.../PluginManager.kt:52-54` |
| Android TV — flavor `playstore` | **stub** (`class PluginManager {}`) | `tv/app/src/playstore/.../PluginManager.kt:13` |

**webOS / Tizen** (`NuvioTVSmart`, `js/core/player/pluginPolicy.js`):

- **Tizen ≥ 6.0** para plugin: *"Tizen plugin support starts at Tizen 6.0"*
  (`pluginPolicy.js:111-117`); Tizen ≥ 6 → quota `modern` (`:138`).
- **webOS ≥ 5** mínimo do app (`:155-161`), mas quota **`modern` só a partir do webOS 6**
  (`:179`); webOS 5 roda com quota `limited`.
- **Navegador: não** (a menos que `__NUVIO_ALLOW_BROWSER_PLUGIN_RUNTIME__`) (`:89-95`).
- **Quotas** (`pluginPolicy.js:4-42`):
  - `modern`: 10 concorrentes, manifest 5 MB, código 5 MB, cache 16 MB, fetch 1 MB,
    **150 resultados** (150 por scraper e global), 60 s por provider, 120 s global,
    memória 64 MB, DOM 8 docs/10 000 elems.
  - `limited`: 1 concorrente, manifest 128 KB, código 1 MB, fetch 512 KB, 25/75 resultados,
    25 s provider, 45 s global, memória 32 MB.
- Android TV real: 10 concorrentes, **150 resultados** (`take(MAX_RESULT_ITEMS)`), 5 MB
  (`tv/app/src/full/.../PluginManager.kt:52-54,691`), 60 s por plugin
  (`tv/app/src/full/.../plugin/PluginRuntime.kt:41`), fetch 1 MB (`:42-43`).

## 6. Incertezas (o que não consegui confirmar)

1. **Nada foi executado em dispositivo** — é leitura estática de código; não rodei o runtime.
2. **webOS/Tizen:** o snapshot diz `pluginServiceAvailable: false` e *"Waiting for the packaged
   plugin service and QuickJS worker handshake"* (`pluginPolicy.js:77,142,185`) — a política de
   quota existe, mas **não consegui provar** que o handshake completa em produção (ou seja, que o
   plugin já roda de fato lá hoje).
3. **Teto de 150 resultados no mobile:** achei no NuvioTV (`PluginManager.kt:53`) e no
   TVSmart (`pluginPolicy.js:18-21`), **não achei** equivalente no NuvioMobile — o comentário do
   TVSmart afirma que o Android limita a 150; no mobile isso não aparece no código que li.
4. **`supportedTypes: ["channel"]` no mobile:** não há bloqueio explícito no caminho do código
   (o teste só prova o scraper default), mas **não existe fluxo de canal que chame plugin** —
   comportamento real não testado.
5. **Teto de tamanho do manifesto no mobile:** não achei limite de bytes para o manifesto
   (o 5 MB é a quota do TVSmart); `httpGetText` lê sem corte.
6. **Id tipo `kitsu:` sem par TMDB:** no mobile o id cru vai para o plugin
   (`resolvePluginTmdbId` devolve o original — `PluginRepository.kt:392-403`); não tracei se
   algum ponto o converte antes (o TV tem `cleanKitsuPluginId`, `StreamRepositoryImpl.kt:388-394`).
7. **Wiki/rewrite:** o wiki do projeto avisa que formatos anteriores ao rewrite KMP podem não
   valer — priorizei o código atual; texto de docs pode estar desatualizado.

## 7. O app passa o TÍTULO junto com o ID?

**Não. Só ID.** Os args são montados exclusivamente com `tmdbId, mediaType, season, episode`
(`PluginRuntime.kt:136-143`; chamada em `JsBindings.kt:40`). Não há `title` em lugar nenhum do
contrato — nem nos bindings host (lista completa no §2).

**Mas o plugin recebe a chave da TMDB e resolve o título sozinho:**

- `globalThis.TMDB_API_KEY` é injetada no boot do sandbox (`JsBindings.kt:7-9`), vinda de
  `__get_tmdb_api_key` → `TmdbSettingsRepository.effectiveApiKey()`
  (`HostFunctions.kt:56`), que é **a chave configurada pelo usuário ou a chave embutida**
  (`TmdbSettingsRepository.kt:45` — `apiKey.ifBlank { TmdbConfig.API_KEY }`).
- Com ela + `fetch` (§2) o plugin chama a TMDB direto: `/movie/{id}`, `/tv/{id}`,
  `/tv/{id}/season/{s}/episode/{e}` — título, ano, nome do episódio, tudo.
- **Não existe nenhuma API de metadados exposta ao plugin** além dessa chave — a lista de bindings
  (§2) não tem `getMeta`/`getTitle`/`getEpisode`.

**Modelo Mirror:** o id já é TMDB, então dentro do `getStreams` a sequência é
`fetch(TMDB com a chave) → título/ano → matchVodTitle → scraping`. Ou seja: a TMDB vira o
resolver de título que hoje o nosso `handleStreams` faz fora.

## 8. Existe `episodeName`/`air_date` ou algo do episódio?

**Não.** Só `season` e `episode` **numéricos** nos args (`PluginRuntime.kt:140-141`). Nenhum campo
de texto do episódio no contrato nem no retorno.

Solução: com a `TMDB_API_KEY` (§7), buscar
`GET https://api.themoviedb.org/3/tv/{id}/season/{s}/episode/{e}?api_key=…`
— devolve `name` (nome do episódio), `air_date`, `overview`, `runtime`. Custa 1 request TMDB por
chamada (cacheável em memória da invocação — ver §9 sobre persistência).

## 9. Cache / persistência entre invocações

**Estado JS: começa do zero a cada chamada.** Cada `getStreams` cria um runtime QuickJS novo e
fecha ao terminar (`val jsRuntime = JsRuntime()` + `use { … }` — `PluginRuntime.kt:133,163-169`).
Variáveis de módulo, memoização em memória, `let cache = …` — **não sobrevivem**. O bytecode dos
polyfills/wrappers é cacheado (`evaluateCached` — `PluginRuntime.kt:184-194`), mas isso é
compilação, não dado.

**Storage gravável pelo plugin: não existe.** Nenhum binding de escrita (lista no §2). O que
existe:

| mecanismo | persiste? | quem escreve | prova |
|---|---|---|---|
| `SCRAPER_SETTINGS` | **sim** (SharedPreferences `settings_<id>`) | **só o usuário**, pela tela de settings (`onSettings` → diálogo) | `JsBindings.kt:6`, `PluginPlatform.android.kt:42-50`, `PluginSettingsDialog.kt:35,189` |
| código do scraper | **sim** (arquivo por perfil) | o app, no refresh do manifesto | `PluginPlatform.android.kt:16,35-40`, `PluginRepository.kt:426` |
| **HTTP cache do OkHttp** | **sim** (disco, **50 MB**, `cacheDir/addon_http`) | automático, **segue os cabeçalhos HTTP** (Cache-Control etc.) | `AddonPlatform.android.kt:87-96`, init em `MainActivity.kt:92`; o `fetch` do plugin passa por esse cliente: `FetchBridge.kt:65` → `httpRequestRaw` → `AddonHttpClientProvider.get()` (`AddonPlatform.android.kt:291`) |

**Resposta prática:** o `fetch` do plugin **pode** ter cache entre invocações (o disco do OkHttp é
compartilhado e persistente), mas só quando a origem permite cache. O que não existe é KV livre
para o plugin guardar estado próprio — cada chamada refaz scraping e, se o título vier da TMDB,
refaz o request da TMDB (a menos que a origem/cache do OkHttp sirva).

---

## 10. TV AO VIVO POR PLUGIN — o método (2ª passada, corrige o §3)

O §3 diz "NÃO por plugin" com base no gate de prefixo. **A leitura completa do gate mostra que ele
não é o caminho usado.** O método existe e é **híbrido**.

### O que a 2ª passada achou (prova arquivo:linha)

**O stream ao vivo PODE sair de plugin.** Em NuvioTV, `buildPluginRequest` tem este ramo **antes** do
gate de prefixo:

```
StreamRepositoryImpl.kt:360  if (tmdbId != null) { return PluginRequest(id = tmdbId, ...) }
StreamRepositoryImpl.kt:368  if (!videoId.canRunLocalPlugins()) return null   ← gate SÓ neste ramo
```

Ou seja: **id numérico passa sem checar tipo nenhum.** `ensureTmdbId` aceita número puro ou
`tmdb:NNN` (`TmdbService.kt:209-231`, ramo numérico `:227-229`). E o teste
`PlaybackAvailabilityTest.kt:40` **não** bloqueia canal — o fixture dele só tinha
`supportedTypes = ["movie","tv"]`; a lógica real é
`plugins.scrapers.any { it.enabled && it.supportsType(type) }` (`PlaybackAvailability.kt:26-30`),
**sem checagem de id**.

- **NuvioMobile/Desktop:** nenhum gate de id — `resolvePluginTmdbId` devolve o id cru
  (`PluginRepository.kt:392-403`); gate é só `supportsType` (`PluginRepository.kt:325-331`).
  Desktop tem `pluginsEnabled = true` (`AppFeaturePolicy.desktop.kt:4`).
- **NuvioTVSmart:** mesmo caminho, id numérico é "fast path" (`streamRepository.js:581-587`).
- **`supportedTypes: ["channel"]` é aceito literalmente** — `normalizePluginType` só converte
  `series/show/other → tv` e deixa o resto passar (`PluginModels.kt:214-218`; TV:
  `Plugin.kt:93-97`). Confirmação de intenção: **PR aberto #2080** *"Keep Stremio types literal …
  channel (channel-of-videos)"*.
- **`mediaType` chega como `"channel"`** (`StreamRepositoryImpl.kt:381-386`, `StreamsRepository.kt:475`).

**O catálogo NÃO pode vir de plugin.** Os 3 runtimes só invocam `getStreams` (+ `onSettings` no
mobile) — não existe `getCatalog`/`getMeta`/`search`/`getSubtitles`
(`JsBindings.kt:31,49`; `PluginRuntime.kt:134-146`; `pluginWorker.js:800-802`). A lista de canais
do Nuvio vem **sempre** de addon Stremio (`/stream/channel/<id>.json`, `AddonTransportUrls.kt:6-24`).

### O método

**Addon estático (só catálogo/meta) + plugin (streams).**

1. **Addon Stremio** servindo `manifest.json` + `catalog/channel/mirror.json` + um `meta/channel/<id>.json`
   por canal — pode ser **arquivo estático no GitHub Pages**: sem servidor Node, sem BeamUp, sem
   banimento. Instalação por URL funciona (`AddonRepository.addAddon`, `AddonRepository.kt:171-210,471-495`;
   a URL normalizada ganha `/manifest.json`).
2. **`id` numérico** no catálogo (`1001…`) — é isso que faz o gate do NuvioTV/TVSmart deixar o
   plugin rodar. O **addon escolhe o id**, então isso é nosso.
3. **Plugin Mirror** com `supportedTypes: ["movie","tv","channel"]`; em
   `getStreams(1001, "channel")` faz a cadeia REI/EMB/ETC/RCD **no aparelho** e devolve o HLS.
   No celular nem precisa do id numérico.
4. Precedente da comunidade: *"[Release] Nuvio Live Sports Plugin — multi-source live"* no
   r/nuvioaddons, ou seja, live via plugin já foi feito.

### O que continua sendo problema (testar, não prometer)

- **Content-type do relay**: o REI entrega a playlist como `__index.txt` (`text/plain`) e a ETC
  termina em `file.txt` — no servidor isso é resolvido pela rota `/stream/hls/`. No aparelho o
  player recebe a URL crua. **Só se descobre testando.** Se o player recusar, aí o relay volta
  (e aí sim precisa de servidor).
- **EPG**: no NuvioTV dá para colocar linhas de guia em `meta.videos`
  (`MetaDetailsViewModel.kt:1701-1706`); no mobile **não achei** tela de guia. E meta estático não
  tem EPG ao vivo — seria GitHub Actions regenerando por dia.
- **Nada testado em aparelho** até aqui: é leitura estática de código.

### Rotas descartadas com prova

| rota | veredito | prova |
|---|---|---|
| catálogo/EPG por plugin | não | só `getStreams`+`onSettings` nos 3 runtimes |
| M3U/Xtream nativo do Nuvio | não upstream | issues #1774/#1440 ("not merging upstream"), PR #3756 pendente — só fork |
| instalar addon de arquivo | não | sem picker; instalação é sempre por URL |
| disfarçar canal como item TMDB | não como TV | gate passa, mas não existe onde listar os canais |

---

## Anexo — artefatos locais

- `/tmp/nuvio/mobile/` — `NuvioMobile` @ `cmp-rewrite` (tarball extraído)
- `/tmp/nuvio/tv/` — `NuvioTV` @ `dev`
- `/tmp/nuvio/tvsmart/` — arquivos-chave de `NuvioTVSmart` @ `main`
- `/tmp/nuvio/*.tree.json` — árvores de `NuvioDesktop` @ `Dev` e `NuvioTVSmart`

Repos oficiais vistos na org: `NuvioMobile`, `NuvioTV`, `NuvioTVSmart`, `NuvioDesktop`,
`NuvioTVTizenBrew`, `NuvioTVWebOS`, `NuvioTizen`, `self-host`, `nuvio-engine`, `MPVKit`.
