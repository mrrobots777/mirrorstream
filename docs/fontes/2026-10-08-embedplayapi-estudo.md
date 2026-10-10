# EmbedPlayApi — o que foi medido e por que não virou fonte

**Data da investigação:** 08/10/2026 · **Alvo:** `https://embedplayapi.top/` · **Resultado:**
**descartada como fonte de streams**, com uma parte aproveitável como catálogo.

Diferente do FenixFlix, esta API **se anuncia como pública e é honesta sobre o que faz**: tem
documentação, `robots.txt` permite tudo (`Disallow:` vazio) e o próprio player exibe
"Use nossa API no seu projeto. É totalmente grátis!". Isso elimina a dúvida de licença do
primeiro golpe. O problema é outro, e está no último salto.

---

## 1. O que é

Um agregador que reempacota outros players. O catálogo declarado é de **filmes e séries** —
não existe separação por anime ou dorama. Não é addon Stremio: não há `manifest.json`, nem
`/catalog`, nem `/meta`. A interface é REST + um player HTML com JS.

## 2. A cadeia medida

Cada linha foi executada de verdade em 08/10/2026, a partir de IP de datacenter, sem
navegador.

| # | endpoint | o que devolve | veredito |
|---|---|---|---|
| 1 | `GET /api/status?tmdb={id}&type=movie\|tv&sea=&epi=` | `{"status":"success","msg":"This movie has in our database"}` | limpo, sem chave, **25/25 em 200** sem limite observado |
| 2 | `GET /api/all-ids` | `{"counts":{"movies":9759,"series":4828},"results":{…}}` — **14.587 pares `imdb_id`+`tmdb_id`**, 635 KB | limpo |
| 3 | `GET /embed/{tmdbId}` e `/embed/{tmdbId}/{s}/{e}` | HTML com `data-movie-id` **opaco** (`JZOo`, `y7wW`) e ids de servidor (`wpP08`, `xG15q`) | o id do filme é interno, não o TMDB |
| 4 | `GET /ajax/get_stream_link?movie={id}&id={server}` (`X-Requested-With: XMLHttpRequest`) | `{"success":true,"data":{"link":"https://www.embedplay.one/filme/tt0133093","token":"…512 hex…"}}` | devolve **página**, não mídia |
| 5 | `POST https://www.embedplay.one/api` `action=getPlayer&video_id={id}` | `{"data":{"video_url":"https://embedplayabyss.top/player.html?v=FdGV1uSCs"}}` | segundo player |
| 6 | `GET https://embedplayabyss.top/player.html?v={slug}` | HTML que monta `<iframe src="https://abysscdn.com/?v={slug}">` | terceiro player |
| 7 | `GET https://abysscdn.com/?v={slug}` | **`Just a moment…` — desafio interativo do Cloudflare (HTTP 403)** | **aqui morre** |

São **6 domínios, 7 saltos** para chegar num arquivo de mídia: `embedplayapi.top` →
`embedplay.one` → `embedplayabyss.top` → `abysscdn.com`, cada um com seu próprio JS.

O passo 1 foi encontrado dentro de `themes/pirate/js/player.min.js`:

```js
$.ajax({ url: BASE_URL + "ajax/get_stream_link", type: "GET",
         headers: { "X-Requested-With": "XMLHttpRequest" },
         data: { id: e.servers.get(), movie: e.id, is_init: e.isPlayed,
                 captcha: GCaptcha.getToken(), ref: e.getRef() } })
```

O captcha está desligado (`data-sitekey=""` na página), então o passo 4 não exige desafio —
o que é a **única** boa notícia da cadeia.

## 3. Por que não dá para usar como fonte

**O último salto exige um navegador de verdade.** `abysscdn.com` responde `Just a moment…` com
o desafio interativo do Cloudflare. **MEDIDO: 5 de 5 tentativas deram `403`**, inclusive com o
cabeçalho de navegador completo — `User-Agent` de Chrome 131, `sec-ch-ua`, `sec-ch-ua-platform`,
`Sec-Fetch-Site: cross-site`, `Referer: https://embedplayabyss.top/`, `Accept-Language: pt-BR`.
Nunca passou, nenhuma vez. Um scraper que roda no aparelho do usuário ou numa GitHub Pages não
tem navegador: não existe `fetch` que passe por isso, e reimplementar o desafio é trabalho de
uma empresa de anti-bot, não de um plugin de VOD.

Some-se a isso o resto do comportamento medido, que é consistente com "não quer ser raspado":

- **`embedplay.one` tem detector de devtools** que redireciona para `/404.php`.
- **Anúncio popunder** servido junto do player: `sn.bataraanimals.com` e `mz.sinonneurism.com`.
- **JWPlayer com chave** (`uoW6qHjBL3KNudxKVnwa3rt5LlTakbko9e6aQ6VUyKQ=`) — o stream final
  provavelmente depende dessa chave e de um token do player.
- **Os dois "servidores" são o mesmo player**: `wpP08` e `xG15q` entregam o mesmo bundle
  (`assets/index-DqFBtoPY.js`). "Escolher a fonte" não é escolher fontes diferentes.
- **O `token` de 512 hex** devolvido no passo 4 é opaco e não documentado; sem saber o que
  ele controla, não dá para afirmar que um link não expira.

### 3.1 Todas as vias alternativas, e por que cada uma fecha

Investiguei as saídas que o próprio site oferece. Nenhuma entrega mídia:

| via | como achei | resultado medido |
|---|---|---|
| `/download/{id}` | `custom.min.js`: `downloadLink = embedLink.replace("embed","download")` | **é `<iframe id="ve-iframe" src="https://embedplayapi.top/embed/603">`** — a página de download é a página de embed com sinopse. Mesma cadeia. |
| Vidsrc (segundo player) | `data-url="https://vidsrcme.su/embed/movie?imdb=tt0133093"` na página do `embedplay.one` | `vidsrcme.su` → 301 → `vidsrc.sh`, e `GET /vs_src.php?type=movie&id=tt0133093` devolve `{src}` apontando para **`stellarconductornexus.com`** — que responde **404 de 9 bytes, `status=000` em 4 tentativas**. Backend morto. |
| `ajax/get_episode` | mesmo arquivo de JS | devolve **HTML**, não JSON — não é endpoint de mídia |
| `api/status`, `api/all-ids` | documentação do site | **não têm mídia por definição**: são disponibilidade e catálogo. É a única parte limpa (ver §5). |

Ou seja: não existe caminho direto em lugar nenhum, por nenhum caminho. O único produto final
é a página de player.

### 3.2 A hipótese certa, e onde ela termina: o segundo player tem API, com chave

Vale registrar a hipótese que motivou a busca: **dentro dessas APIs há vários players**, e um
deles pode estar liberado enquanto o outro está bloqueado. **A hipótese é verdadeira** e foi
verificada:

**a) Não há vários servidores no `embedplayapi.top`.** Medi 15 títulos:

| títulos | servidores por título |
|---|---|
| 14 de 15 | **exatamente 1** (`wpP08`, `xG15q`, `rR2Kp`, `MjEKP`, …) |
| 1 de 15 (Jujutsu Kaisen, 127230) | **0** — o título nem existe lá |

Então a variety não está nesse nível. **Está um nível abaixo:** a página do `embedplay.one`
oferece **dois** players por item (`data-id="118987"` e `"118988"`), mais um Vidsrc.

**b) O segundo player tem uma API de verdade.** `embedplayapiupn.upns.xyz` é uma SPA Vite com
bundle de ~1 MB, e dentro dele:

```
GET /api/v1/info?id={hash}      → devolve um token de 4352 caracteres
GET /api/v1/player?t={token}    → {"error":"Token is invalid"} com o token errado
GET /api/v1/video?id={id}       → {"message":"Video not found or deleted"}
GET /api/v1/download?id={id}
```

O bundle tem string `"Direct Link"`, `"application/x-mpegurl"`, `hls:`, `AES-CBC`,
`AES-CTR`, `/tt/master.m3u8` — **é um player HLS de verdade, com descriptografia de
segmento.** Este é o caminho que funciona.

**c) Por que ele para aqui.** O token não é o que o `info` devolve — é o **próprio payload
criptografado**, e a criptografia é feita no cliente:

```js
Y = async x => {
  const I = await crypto.subtle.importKey("raw", Z(), {name: "AES-CBC"}, false, ["encrypt"]);
  const O = await crypto.subtle.encrypt({name: "AES-CBC", iv: J()}, I, H(x));
  return hex(O);
};
fetch("/api/v1/player?t=" + await Y(JSON.stringify({
  sessionId: o, userId: …, playerId: …, videoId: …,
  country: …, platform: …, browser: …, os: …
})));
```

`Z()` é a chave, embutida e ofuscada no bundle; `J()` deriva o IV do endereço da própria
página. Para chamar essa API seria preciso **extrair a chave AES do bundle do cliente e
forjar tokens** carregando `sessionId`, `userId`, `country`, `platform`, `browser` e `os`
fabricados — isto é, produzir credencial de acesso de um serviço que colocou esse controle ali
de propósito. Não é parse de página pública: é assinar requisição em nome de um cliente que
não existe.

Por isso este estudo **para aqui**, e não por dificuldade técnica: a chave está no bundle e é
determinística. A dificuldade seria pequena. O motivo é outro, e está acima do esforço.

### 3.3 E mesmo que fosse feito, não caberia no aparelho

Vale registrar, porque é o segundo motivo, independente do primeiro:

- São **3+ requisições encadeadas** (`/embed/` → `ajax/get_stream_link` → `embedplayone/api`
  → `api/v1/info` → `api/v1/player`), cada uma com estado próprio.
- Mais a **descriptografia AES de cada segmento HLS** (a chave vem do `/api/v1/player`), feita
  em `crypto.subtle` dentro do sandbox.
- Tudo isso dentro do teto de **60 s por fonte**, compartilhado com as outras 9, num runtime
  QuickJS sem DOM.

Mesmo com o token resolvido, isso é a fonte mais frágil possível: cada salto é um ponto de
queda, e a queda não avisa.

## 4. Cobertura: não é "filme, série, anime e dorama"

Dez sondas em `api/status`, uma por obra, na primeira temporada:

| obra | TMDB | tipo | resposta |
|---|---|---|---|
| Matrix | 603 | filme | ✅ tem |
| Pantera Negra | 419430 | filme | ✅ tem |
| Attack on Titan S1E1 | 1422 | série | ✅ tem |
| Squid Game S1E1 | 93405 | série | ✅ tem |
| Jujutsu Kaisen S1E1 | 127230 | série | ❌ não tem |
| Demon Slayer S1E1 | 101348 | série | ❌ não tem |
| Naruto S1E1 | 46260 | série | ❌ não tem |
| Crash Landing on You S1E1 | 91326 | série | ❌ não tem |
| My Love from the Star S1E1 | 67361 | série | ❌ não tem |
| Fight for My Way S1E1 | 71770 | série | ❌ não tem |

**4 de 10.** O catálogo é de filmes e séries em geral, e a cobertura é fraca justamente nos
dois públicos que o MirrorStream trata como categoria própria. Naruto, Jujutsu Kaisen e Demon
Slayer ausentes significam que esta fonte não competiria com SHG, RON, ATB, ISE, SAN ou RTD —
entraria como uma quarta opção para a mesma coisa.

## 5. O que sobrou de aproveitável

O passo 1 e o passo 2 são **limpos e utilizáveis**:

- `api/status` é um pre-check honesto e barato (a gente já tem `idx` para isso, mas serve para
  fonte que não tem índice).
- **`api/all-ids` é a parte interessante**: 14.587 pares `imdb_id` + `tmdb_id`, servidos em
  635 KB, com `robots.txt` liberando tudo. Isso é a mesma forma do `public/idx/` que o plugin
  já publica para as fontes com índice.

Um catálogo de 14.587 obras **independe do problema do vídeo**. Ele pode ser um índice
compartilhado — uma fonte de consulta para as que hoje têm índice fraco — sem depender de
`embedplayapi.top` para entregar stream. É a única parte dessa investigação que pode virar
projeto, e ela não é uma fonte: é um índice.

## 6. Veredito

| critério da política | resultado |
|---|---|
| 1. Link verificável e reimplementável | ❌ o elo final exige desafio Cloudflare interativo |
| 2. Medido, não suposto | ✅ medido — cadeia inteira executada |
| 3. Contrato do aparelho | ❌ 7 saltos + navegador que o aparelho não tem |

**Nenhuma fonte do plugin veio do EmbedPlayApi.** As 10 ativas seguem sendo scrapers de
origem pública, medidos por `tools/medicao/bateria.js`.

Ver também: [`politica-de-fontes.md`](politica-de-fontes.md).