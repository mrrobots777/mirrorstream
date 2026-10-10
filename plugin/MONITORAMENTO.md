# Monitoramento das fontes VOD

O plugin possui um monitoramento real por fonte:

```bash
cd plugin
npm ci
npm run build
npm run monitorar
```

Cada execução grava:

- `logs/fontes-<timestamp>.jsonl`: uma linha JSON por fonte;
- `logs/resumo-<timestamp>.json`: resumo agregado.

Os logs locais não entram no Git. No GitHub Actions, o workflow `monitorar-fontes-vod` roda a cada 3 horas e publica os logs como artifact por 14 dias.

## Variáveis úteis

| Variável | Uso |
|---|---|
| `FONTES=aon,rtd,vzr` | monitora somente as fontes indicadas |
| `PROBE_MAX=2` | quantidade de links por fonte submetidos à prova de vida |
| `MONITOR_TIMEOUT_MS=65000` | teto por scraper |
| `MIRROR_EDGE_MODE=auto` | tenta a origem e usa worker somente em erro/bloqueio |
| `MIRROR_EDGE_MODE=nunca` | desativa workers e usa somente a origem |
| `MIRROR_INDEX_BASE=...` | usa uma base local de índices nos testes |

## Resultado da última bateria real (08/10/2026)

As 10 fontes publicadas entregaram stream, link vivo e qualidade lida do vídeo:

- **SHG, RON, ATB, BLZ, SPC, ATO, ISE, SAN, RTD e DGO** — `com stream: 10/10`,
  `sem nenhum link vivo: 0 de 10`, `sem qualidade real: 0 de 10`, `contrato quebrado: 0`.
- Mais rápidas: SAN 0,7 s, ISE 1,8 s, RTD 1,9 s. Mais lentas: ATB 6,7 s, RON 6,8 s.

Casos registrados como falha de origem, não como sucesso falso:

- SPT: a API entrega opções, mas os três embeds atuais não entregaram mídia ao resolvedor;
- AON: o worker contorna o bloqueio inicial da API, mas o token AniDrive testado respondeu 404/403;
- VZR: `wp-json/api/v1/player` respondeu 403 diretamente e pelo worker.

## O RTD foi reativado: a medição de 02/10 estava errada

O RTD estava desativado desde 02/10 com o motivo "catalog/play-link respondeu 403". O scraper
**já usava** o contrato oficial (`/api/catalog-index` + `/api/play-link?contract=3`), então não
havia migração a fazer — o que faltava era a medição certo.

MEDIDO 08/10/2026: o `redetoons.win` não resolve DNS (o domínio saiu), mas o
`redetoonstv.win` está no ar e responde **451 sem `Referer` e 200 com ele** — 174 KB de índice
(4.863 séries + 21.006 filmes). O 403 que motivou a desativação vinha da rota, não da origem.
O `play-link?contract=3` devolve o contrato 3 e dois variants (dublado e legendado) em
`cnn.radiogaucha.fun`, que entrega `206 video/mp4` — 1280x960 lido do arquivo.

Estabilidade: três execuções seguidas dão 2 streams em 1,6 s / 2,1 s / 2,1 s, e duas chamadas
**paralelas** da mesma fonte (o que o app faz com 10 scrapers) dão 2 e 1 stream sem erro.

O RTD tem **limite de taxa por IP** e o sintoma é **429**, não 403. MEDIDO: cinco chamadas
consecutivas com menos de 2,5 s de intervalo dão 429 e caem no worker, que também leva 429;
com **5 s** entre chamadas — o ritmo de um usuário abrindo um título por vez — as cinco dão
stream (603, 30984, 278, 550, 13). Na rajada das 10 fontes simultâneas ele deu 403 uma vez em
duas. É instabilidade transitória de origem, não queda da fonte, e por isso o `fontes.js` não
trata 429 como motivo de desativação.

## O caso do SPC mudou porque o item morreu na origem, não a fonte

O caso da bateria era 603 (Matrix) e passou a reportar `sem nenhum link vivo`. MEDIDO: os **dois**
arquivos desse filme no painel SPC respondem **404**, e a série do mesmo painel responde 206.
Cinco outros filmes (278, 550, 13, 680, 329865) respondem 206. É arquivo morto na origem para
aquele item, e um monitor que reportasse isso como "fonte quebrada" estaria mentindo. O caso
trocou para 550 e a nota ficou em `tools/medicao/casos.js`.

## Duas fontes novas: ISE e SAN

Portadas do `zeus-open-source` (MIT), reescritas para o formato do plugin — não portadas byte a
byte. As duas passaram pela medição antes de entrarem no registro.

- **ISE** (Isekai BR, `ryuneko.lol/novok3`): 3 chamadas, MP4 direto, sem player nem crypto.
- **SAN** (Super Animes, `api.animestvs.org`): 2 chamadas, MP4 direto.

O que a medicao mudou em relacao ao codigo de origem:

1. **SAN nao baixa o catalogo.** O catalogo completo tem 4,7 MB e o teto de corpo do runtime e'
   1 MB; o codigo de origem usa `stream-json` para varrer isso, que nao existe no plugin. A
   fonte deriva o slug do titulo que o TMDB ja deu e pede so a lista de episodios daquele anime
   (MEDIDO: One Piece com 1.176 episodios devolve 326 KB, Naruto 57 KB).
2. **ISE nao confia no nome do tier.** O payload traz `downloadfullhd`, `downloadhd` e
   `downloadsd`; MEDIDO, o `downloadfullhd` responde **404** para os ids testados (31779, 31780,
   31781, 31800) enquanto o `downloadhd` responde 206 (960x720). A triagem por status decide o
   que entra na lista; o nome do campo não.
3. **AnimeFire foi descartado antes de portar:** `api.animefire.io` não resolve DNS. O site
   responde 301, a API não existe mais.

## O deploy publicava 7 fontes de 10, e a causa era o gate (08/10/2026)

MEDIDO: `https://mrrobots777.github.io/mirrorstream/manifest.json` declarava **7** scrapers
(SHG, RON, ATB, BLZ, SPC, ATO, DGO) enquanto o registro tinha 10 — e `ise.js`, `rtd.js` e
`san.js` respondiam **404** na mesma URL. O `npm run build` local declarava as 10 e não
acusava nada, porque o build confere o manifesto contra o registro e os dois concordavam.

O gate do `publicar-pages.yml` validava `m.scrapers.length !== 7` com o número escrito à mão.
Ele era mentira sobre o registro, e o deploy publicava o artefato assim mesmo: a validação não
comparava com nada que importasse. Agora o número vem de `src/core/fontes/` e o gate também
exige que **todo bundle listado no manifesto exista em `public/`** — que é o que pega o 404 do
`ise.js`.

Dois bloqueios independentes no mesmo deploy:

1. **A raiz do link respondia 404** (`manifest.json` respondia 200). O Nuvio pede a raiz do
   repositório de plugins, e `public/` não tinha `index.html` nem `.nojekyll`. Os dois são
   gerados por `npm run build`, e não versionados à mão em `public/` porque `apagaFora` remove
   da pasta tudo que não seja bundle ou índice — MEDIDO, a primeira versão escreveu os
   arquivos no working tree e o build seguinte apagou os dois.
2. **`gerar-indice.js` derrubava o processo inteiro** quando uma fonte falhava. O `mirror-ato`
   responde `403 host not allowed` para `firetvcb.net`: o host está na allowlist do
   `mirror-cdn.js` desde 07/10, mas o **worker publicado é anterior a essa entrada** —
   allowlist é parte do código do worker, então host novo só entra em produção no próximo
   deploy. O `throw` derrubava o gerador DEPOIS de BLZ e SPC já terem escrito os shards, e o
   `apagaTudo` do começo tinha limpo o diretório anterior: o deploy perdia os três.

MEDIDO na ordem das rotas: o painel do ATO responde **200 direto** (11,97 MB de catálogo) e o
worker responde **403**. A rota boa era a última a ser tentada. Agora é a mesma política de
`src/lib/http.js` — worker primeiro, painel direto como reserva — e uma fonte que perde o
shard é **alerta**, não erro: ela continua no manifesto e cai no catálogo gzip em tempo de
execução. Perder uma fonte é perda de velocidade nela; perder todas é não ter índice nenhum.

O `indice.json` registra a rota de cada fonte (`ato` com `via: "reserva (painel direto)"` e
`viaReserva: "HTTP 403 em mirror-ato..."`), porque um shard gerado pelo caminho de reserva é
um shard válido, mas quem lê o log precisa saber que a rota preferida está fora.

MEDIDO: 103.549 itens em 7,26 MB, maior shard 280 KB (teto do runtime 1024 KB, 512 KB na
quota `limited`). `semShard: []`.

## `idx` não é "tem shard": é o prefixo, e o RTD não tem painel

MEDIDO: `fontesComIndice()` devolvia o RTD, e o gerador montava
`https://:/player_api.php?...` — sem `servidor`/`usuario`/`senha`, porque o RTD não é painel
Xtream, é a API `/api/catalog-index`. O erro era `Failed to parse URL`, que não dizia nada
sobre o RTD, e o registro marcava a fonte como "sem shard".

No app nada disso aparecia: o RTD funciona pela API dele. O que faltava era distinguir duas
coisas que o campo `idx` estava misturando:

| lista | quem entra | para quê |
|---|---|---|
| `fontesComIndice()` | BLZ, SPC, ATO, RTD | quem tem **prefixo** de shard para ler do mesmo endereço do manifesto |
| `fontesDePainel()` | BLZ, SPC, ATO | quem tem **credencial de painel** para o gerador construir o shard |

O RTD ficou com `painel: false` no registro, que é a declaração explícita: prefixo de shard
sim, painel Xtream não.

## O DGO agora casa por id, não por pontuação

MEDIDO na busca real: o `img src` do card é `/imagens/94796_T1_tv_size_w600.webp` — e 94796 é
exatamente o id de série que o TMDB devolve para o mesmo conteúdo. O caminho antigo aceitava até
3 candidatos ordenados por `matchScore`, que é pontuar para adivinhar; agora o casamento é por id
e o título vira guarda, não critério de escolha.

Detalhe que custou uma volta: `tmdbIdDe` devolve **string** e o poster traz **number**, então
`94796 !== "94796"` descartava todo candidato e a fonte devolvia `[]` — que é exatamente o
sintoma medido. A comparação é numérica de propósito agora.

## O ATO mudou de host (07/10/2026)

O painel "Autos" trocou de host **e** de credencial. A prova de que é o mesmo painel: os
dois catálogos têm **31.677 de 31.677 itens com `stream_id` e nome idênticos**, e o
`get_vod_info` dos dois lados devolve o mesmo `tmdb_id` (1138304 para "Licença para
Enlouquecer", id 399954).

O host antigo saiu do ar: `4x4u29c.autos` resolve (38.100.202.66) mas não abre TCP em 80
nem 443 — 3 tentativas de 12 s, e o worker também leva `Upstream 403` na mídia. A API
ainda respondia pelo worker (12,5 MB de catálogo), o que mascarava a queda: a fonte
descobria o stream e entregava link que não tocava.

No host novo a mídia responde: `GET /movie/<user>/<pass>/<id>.mp4` devolve **302** para um
CDN com token JWT (`38.99.239.251`), e seguindo o redirect o `Range` de 160 KB vem
`206 video/mp4` com resolução legível. O `pegar` segue redirect por padrão.

Duas coisas foram medidas e não são detalhe:

1. **O link do ATO precisa de `User-Agent`.** Sem UA o host responde **403**; com qualquer
   UA (inclusive `okhttp`, `Dalvik` e `ExoPlayerLib`, que é o que o aparelho manda) responde
   302 normal. O Nuvio manda UA no player, então o caminho funciona — mas é a razão de o
   `getStreams` não declarar `headers` aqui.
2. **O worker precisou do host novo na allowlist.** `firetvcb.net` estava barrado pelo guarda
   `host not allowed` (`infra/workers/mirror-cdn.js`, `ALLOWED_HOSTS`). O `4x4u29c.autos` continua na
   lista, porque host que volta não deve precisar de novo deploy para funcionar.

Os shards de `/idx/ato/` **continuam válidos** — o catálogo é o mesmo item a item, então não
houve o que regerar.

## Borda contra origem: medido, não suposto (08/10/2026)

`npm run medir` (`tools/medicao/medir-rotas.js`) mede as DUAS rotas da mesma URL, N vezes, e reporta
o tempo até o primeiro byte, o total, os bytes e o `x-mirror-cache`. Ele resolve as URLs de
mídia por `getStreams` na hora da medição, porque link escrito à mão envelhece: o do RTD
expirou entre ser escrito e ser medido, e teria reportado "a borda é lenta" sem nunca ter
medido a borda.

MEDIDO em API (3 amostras, IP de datacenter):

| fonte | rota | ttfb | total |
|---|---|---|---|
| RTD `catalog-index` (174 KB) | direta | 119 ms | 176 ms |
| RTD `catalog-index` | borda | 125 ms | 198 ms |
| AON (461 KB) | direta | 1231 ms | 1543 ms |
| AON | borda | 507 ms | 863 ms |
| ATB (831 KB) | direta | 652 ms | 763 ms |
| ATB | borda | 908 ms | 1284 ms |

A leitura honesta: **a borda não é sistematicamente mais rápida.** No RTD ela é 6% mais
lenta (125 ms contra 119 ms de ttfb) e no AON é 2,4× mais rápida, no ATB 40% mais lenta. Os
números variam por rota até o CDN de destino e por colocation, e o ganho do AON é o
handshake TLS a menos numa origem que responde devagar. Isto confirma a política escrita:
origem primeiro, worker como reserva — porque a reserva não é um acelerador.

## O estrangulamento do DGO era por requisição, não por origem (08/10/2026)

MEDIDO: o CDN do DGO entrega o manifest do episódio (`stream.m3u8`, 24.103 B) em **13,9 s**
numa requisição inteira — 1,7 kB/s. Ler o corpo todo estourava o orçamento de 5 s da sonda
(`MS_SONDA`) e a fonte saía sem `quality` mesmo respondendo normalmente.

O que a medição por faixas esclareceu (e o que um único número esconde): **o estrangulamento
é por requisição, não por origem.** MEDIDO com 4 requisições separadas de 4 KB cada:

| faixa | status | tempo |
|---|---|---|
| `bytes=0-4095` | 206 | 574 ms |
| `bytes=4096-8191` | 206 | 600 ms |
| `bytes=8192-12287` | 206 | 705 ms |
| `bytes=12288-16383` | 206 | 394 ms |

Quatro requisições de 4 KB levam 2,3 s; uma requisição de 16 KB leva 11,8 s. O mesmo host,
a mesma faixa de bytes, o mesmo `Referer` — só muda o tamanho da resposta. É a origem que
entrega o primeiro bloco rápido e depois estrangula a conexão, o que faz o `Range` ser a
correção certa e não um truque.

Com a leitura por faixas (`lerPlaylist` em `src/lib/video-probe.js`), MEDIDO na sonda real:

| tentativa | tempo | resultado |
|---|---|---|
| 1 | 2005 ms | 640x480 |
| 2 | 1330 ms | 640x480 |
| 3 | 1440 ms | 640x480 |

De 13,9 s com timeout para 1,3–2,0 s com resolução lida do vídeo. O atributo `tempo` do
`probeVideoInfo` que o DGO reportava antes era falha de transporte, não de fonte.

Em **mídia** o quadro é mais claro, e é o número que o player sente (512 KB via `Range`):

| fonte | bytes | total | vazão |
|---|---|---|---|
| ISE | 524288 B | 210 ms | 2438 kB/s |
| SAN | 524288 B | 200 ms | 2560 kB/s |
| SHG | 524288 B | 239 ms | 2142 kB/s |
| ATB (1º segmento HLS) | 524288 B | 201 ms | 2547 kB/s |
| DGO (1º segmento HLS) | 191572 B | 165 ms | 1134 kB/s |
| RTD | 524288 B | 625 ms | 819 kB/s |
| ATO | 524288 B | 2002 ms | 256 kB/s |

O caminho de mídia agora é seletivo: `MEDIA_WORKER_POR_HOST` (`src/core/politica.js`)
roteia apenas `kakito.xyz`, `telaplay93.top`, `firetvcb.net` e `4x4u29c.autos` para o
Worker da própria fonte. O endpoint `/proxy?media=1` cacheia playlists HLS e segmentos, preserva
`Range`/`Referer` e devolve `307` para o link original quando a origem recusa a borda.
Arquivos MP4 grandes não são guardados inteiros no Worker; continuam em streaming com
fallback direto. Hosts sem rota explícita continuam sempre diretos.

O ATO é a exceção que confirma a regra: 256 kB/s e 970 ms de ttfb é o painel servindo o
`302` para o CDN com token (`MONITORAMENTO.md`, seção do ATO) — a lentidão está na origem,
e nenhuma borda corrige uma origem que entrega o arquivo devagar.

## Cloudflare Workers

O modo Edge é viável como **fallback de transporte** para APIs e páginas bloqueadas, desde que os workers sejam controlados pelo projeto e encaminhem corretamente método, query string, headers, status e corpo.

Ele não garante 100% dos streams porque:

1. o upstream pode continuar retornando 403/404 no próprio worker;
2. tokens e URLs assinadas podem expirar ou depender do IP/sessão do usuário;
3. o worker pode ter limites de CPU, subrequest, tamanho e cota;
4. fazer proxy do vídeo inteiro aumenta custo e latência;
5. cabeçalhos `Referer`, cookies e CORS precisam ser preservados de acordo com o player;
6. um worker não corrige um embed que deixou de existir.

Por isso o plugin usa **origem direta primeiro** e worker apenas como fallback, com logs `[edge]` para indicar quando ele foi usado.

A allowlist do worker (`ALLOWED_HOSTS` em `infra/workers/mirror-cdn.js`) é **parte do contrato da fonte**: um host que entra como fonte e não entra na lista não tem fallback nenhum, porque o guarda `host not allowed` responde 403 antes de qualquer fetch. Toda fonte que usa worker precisa do host na lista, e a lista se atualiza junto com a fonte.

## Política de estabilidade e descarte

Uma fonte só permanece no manifesto quando entrega streams e pelo menos um link verificável. O monitor mede a fonte ativa; bloqueio isolado ou `timeout` é tratado como instabilidade transitória. A fonte é desativada do manifesto quando há repetição de bloqueio/erro estrutural ou nenhum embed de mídia, mesmo após o fallback Edge.

Atualmente estão desativadas, mas não apagadas do código: **SKI**, **AON**, **SPT** e **VZR**. Para reativar uma delas, remova `ativo: false` em `src/core/fontes/`, corrija o upstream/scraper e confirme duas baterias consecutivas com stream e link vivo.

As fontes publicadas são **SHG, RON, ATB, BLZ, SPC, ATO, ISE, SAN, RTD e DGO**. Todas passam pela mesma política HTTP: timeout de cabeçalho/corpo, origem direta primeiro, fallback Edge nos mesmos status (403, 408, 429, 500, 502, 503 e 504), uma tentativa Edge e registro do evento.

## API HTTP

`npm run api` sobe `tools/publicacao/servidor-api.js`, que carrega os **mesmos bundles de `dist/`** que o
app recebe — não existe caminho pelo qual a API e o plugin divirjam entre builds.

O motivo de ela existir: o `manifest.json` só é lido pelo app e o `getStreams` só roda dentro do
runtime dele, o que torna impossível integrar o catálogo com outro consumidor, rodar a bateria de
um servidor, ou depurar uma fonte sem aparelho.

O corpo distingue `vazio` de `erro` porque o app distingue (`[]` é "sem fonte", exceção é "com
erro") e achatar os dois num 500 daria ao consumidor uma informação falsa sobre a origem.
