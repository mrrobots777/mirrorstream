# FenixFlix — o que foi medido e por que não virou fonte

**Data da investigação:** 08/10/2026 · **Alvo:** `https://fenixflix.fenixhub.online/.../manifest.json`
· **Resultado:** **descartado** como fonte do MirrorStream. Não há scraper a extrair.

Este arquivo existe para ninguém refazer o caminho. A pergunta "dá pra adicionar o FenixFlix"
volta, e a resposta é não — por um motivo específico, medido, que não é "o site estava fora".

---

## 1. O que é

Um addon Stremio **FastAPI**, servido atrás de Cloudflare, que se apresenta como
`com.fenixflix` v1.2.0. O `manifest.json` declara:

```json
{
  "resources": ["stream", "catalog"],
  "idPrefixes": ["tt", "tmdb", "dramabox", "kitsu"],
  "catalogs": [{ "type": "movie", "id": "recentes_servidor", ... }]
}
```

Os prefixos `dramabox` e `kitsu` chamam atenção: sugerem um agregador que indexa outras
plataformas. É a hypothesis que sustentou a investigação.

## 2. As rotas reais

`openapi.json` expõe exatamente três rotas Stremio e mais duas que não são do addon:

| rota | comportamento medido |
|---|---|
| `/manifest` | devolve o manifesto acima |
| `/catalog/{tipo}/{id}` | `recentes_servidor` funciona; `populares_fenix` devolve lista **vazia**; `search=` funciona como filtro a mais |
| `/stream/{tipo}/{id}` | exige o caminho `/tproxy/{short_id}` no resultado |
| `/tproxy/{short_id}` | **não é do addon**: é o "Tomato Proxy", que resolve o MP4 |
| `/admin/banned` | painel de ban por IP |

Duas ausências que já custaram a hypothesis:

- **`/meta/*` responde 404.** Não há catálogo por título — o addon não sabe o que é um filme.
- **`recentes_servidor` devolve 40 metas e não pagina.** Não há como varrer a biblioteca.

Para série seria preciso `tt…:1:1` (imdbId:temporada:episódio). Nada disso é um scraper: é um
proxy de biblioteca alheia.

## 3. Por que não dá para extrair os links

O `stream` devolve um caminho `/tproxy/{short_id}` que **não é do addon**. O MP4 é servido por
**quatro backends próprios**, cada um com seu próprio token:

- `husky-denny-*.koyeb.app`
- `passing-melinda-*.koyeb.app`
- `fenixflix-fenixstudio.hf.space`
- `fenixbot.squareweb.app`

O token viaja em `?hash=`. **Medido:** o mesmo `hash` apresentado em um host diferente devolve
**404**. O hash é por host. Isso significa que o addon não é um scraper com uma regra de
parse — é uma biblioteca particular servida comFour separate backends, cada um com um token
por host, que não pode ser reimplementada sem copiar a infraestrutura deles.

Some-se a isso:

- **"Proxy link expired or invalid"** — os links têm validade curta, o que é o oposto do que
  o Nuvio precisa (o aparelho resolve `getStreams` na hora, mas a fonte precisa entregar algo
  que não morra no meio da sessão).
- **A configuração na URL é decorativa.** `…/lixo/manifest.json` devolve o mesmo manifesto que
  `…/manifest.json`. O segmento é cosmético.
- **`/admin/banned`** é um painel de ban por IP: a origem já se trata como fechada.

## 4. Veredito

Não é uma fonte de conteúdo aberto com regra de parse extraível. É uma biblioteca self-hosted
com token por host e backends próprios. Reproduzi-la significaria copiar a infraestrutura de
terceiros — o oposto do que o MirrorStream faz, onde cada fonte é um scraper público do
próprio site, medido e com queda declarada.

**Nenhuma fonte do plugin veio do FenixFlix.** Isso foi verificado: as 10 ativas (SHG, RON,
ATB, ISE, SAN, RTD, BLZ, SPC, ATO, DGO) são scrapers de origem pública, medidos por
`tools/medicao/bateria.js`.

## 5. O que sobrou de útil

Duas lições que valem para qualquer origem futura:

1. **Antes de investigar a fundo, leia o `openapi.json`.** Ele diz o tamanho do problema em um
   `curl`. Foi ele que mostrou que `/meta` é 404 e que `/tproxy` é de outro serviço.
2. **"Tem catálogo" não quer dizer "tem scraper".** O FenixFlix tem `catalog` e `stream` no
   manifesto e mesmo assim não oferece nada extraível. O critério é **link verificável e
   reimplementável**, não a declaração de recurso.

Ver também: [`politica-de-fontes.md`](politica-de-fontes.md) — o critério de entrada e saída de
uma fonte — e [`2026-10-08-embedplayapi-estudo.md`](2026-10-08-embedplayapi-estudo.md), uma
origem que **passava** nos critérios 1 e 2 (API pública, `robots.txt` liberado, medida) e
**caiu no 3**: o link final exige desafio interativo de navegador.