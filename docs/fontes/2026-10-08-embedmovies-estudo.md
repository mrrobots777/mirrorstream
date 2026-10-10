# EmbedMovies.org — o que foi medido e por que não virou fonte

**Data da investigação:** 08/10/2026 · **Alvo:** `https://embedmovies.org/` · **Player real:**
`https://myembed.biz/` · **Resultado:** **descartada — o operador proíbe explicitamente o que o
plugin precisa.**

Esta é a recusa mais limpa de registrar: aqui **não há engenharia reversa a fazer**, porque o
serviço diz o que entrega, e não é o que我们需要.

---

## 1. O que é

Uma API de players para site, com três categorias — **Filmes, Séries, Animes** — e um guia de
integração de uma linha. Sem cadastro, sem API key, sem aprovação ("Comece a usar
imediatamente").

O `embedmovies.org` é só a página de venda; o player é **`myembed.biz`**.

## 2. A API, como documentada

| rota | o que faz |
|---|---|
| `https://myembed.biz/filme/{tmdb}` | player de filme |
| `https://myembed.biz/filme/{tt…}` | id IMDb também serve |
| `https://myembed.biz/serie/{tmdb}` | player com a lista de temporadas/episódios |
| `https://myembed.biz/serie/{tmdb}/{temporada}/{episodio}` | episódio direto |

Só isso. Não existe `manifest.json`, `openapi.json`, `/catalog`, `/meta` nem endpoint JSON de
fonte — testei quatro caminhos de addon Stremio e os quatro devolveram `200 text/html`, porque
é um *catch-all* do site, não uma API de addon.

## 3. A frase que decide

O guia traz, em destaque:

> **Atenção:** A reprodução do conteúdo funciona **exclusivamente via iframe**. Não fornecemos
> links diretos de vídeo (`.mp4`, `.m3u8`) para download ou uso em players personalizados
> externos. Copie o código abaixo e cole no HTML do seu site.

## 4. Confirmei que a frase é verdade

`GET https://myembed.biz/filme/tt0133093` → **HTTP 200, 95 KB**, e:

- **`grep -c 'm3u8\|\.mp4'` → 0.** Nenhuma mídia na página.
- Nenhum `data-api`, nenhum `/ajax/*`, nenhuma chamada JSON no JS inline.
- Nenhum `<iframe>` com `src` no HTML (as 4 ocorrências de "iframe" são dentro de JS).
- O que o JS inline faz é carregar anúncio: `cmp.inmobi.com` (InMobi) e
  `mypopads.com/requests/display.php?r=sticky` (sticky popup).

Não há o que extrair: a mídia só existe **dentro** do iframe, carregada por um provedor
externo a essa página.

## 4.1 "Então faz scraping do site" — resposta medida

Raspagem não helpa quando o alvo não expõe o link, e aqui ele não expõe. Concretamente:

- **Não há requisição de mídia para interceptar.** A página não pede `m3u8` nem `mp4`; ela
  pede InMobi e um popup. O vídeo entra por um iframe servido por outro domínio, cujo
  conteúdo só existe depois que **um navegador** executa o JS dele.
- **Rust não é o gargalo — o alvo é.** Um scraper perfeito ainda teria que devolver
  `https://myembed.biz/filme/tt0133093` no campo `url`, e o Nuvio **descarta o item** (§5).
- Se algum dia o `myembed.biz` passar a expor a mídia, aí sim vale um scraper — e vale medir
  de novo antes de escrever código.

## 5. Por que isso impede o scraper

O contrato do Nuvio é medido e está em `docs/estudos/nuvio-plugin-estudo.md:196-249`:

> cada item é parseado com `url` (**obrigatório — sem ele o item é descartado**), `title`,
> `name`, `quality`, `size`, `language`, `provider`, `type`, `seeders`, `peers`, `infoHash`,
> `headers`, `subtitles[]`

`url` é **obrigatório** e é a URL que o player vai tocar. Não existe campo para "página de
player", "iframe" ou "embed". Devolver `https://myembed.biz/filme/tt0133093` nesse campo
significa entregar ao player um HTML de 95 KB com dois scripts de anúncio — o item não toca
nada.

E a fuga óbvia também não existe: nosso `infra/workers/mirror-cdn.js` é um proxy `fetch`, e
**Worker não roda navegador** — não resolve desafio Cloudflare nem executa o JS que só
descobre a mídia dentro do iframe. O obstáculo aqui nem é anti-bot: é que o link direto não
existe para ser buscado.

## 6. Veredito

| critério da política | resultado |
|---|---|
| 1. Link verificável e reimplementável | ❌ **não há link direto** — o operador proíbe e a página não tem |
| 2. Medido, não suposto | ✅ medido: página baixada, zero mídia, dois ads |
| 3. Contrato do aparelho | ❌ `url` exige mídia; página de player não é |

**Nenhuma fonte do plugin veio do EmbedMovies.** As 10 ativas seguem sendo scrapers de origem
pública, medidos por `tools/medicao/bateria.js`.

## 7. Nota de método

Vale registrar **por que esta investigação foi curta**: eu não deveria gastar这里 o tempo de um
estudo completo. A documentação do serviço já dizia que não entrega link direto, e essa frase
é o critério de entrada nº1 da
[`politica-de-fontes.md`](politica-de-fontes.md). A leitura que economiza tempo é: **procurar
primeiro se o serviço promete o que o aparelho precisa.** Promessa de link direto é requisito,
não detalhe — e quando o serviço promete o contrário, o estudo cabe em uma página.