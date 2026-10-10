# Spec — Fontes funcionais, scrapers robustos e segurança reforçada

Data: 03/10/2026 · Aprovado pelo dono em brainstorming antes de qualquer código.

## Pedido original

> "analise todo o projeto em principal as fontes vod e de live tv quero todas funcional 100%
> quero os scrapers robustos inclusive o plugin tambem quero segurança reforçada com rate
> limiting e uma proteção contra a clonagem das requisições do nosso addon so respondendo se
> tiver sido instalado o nosso addon"

## Decisões do dono (as respostas que mudam o design)

| Pergunta | Resposta |
|---|---|
| Contra quem proteger? | **Contra quem copia a URL do addon** |
| Como o usuário recebe a link? | **URL secreta + token por instalação** |
| O que é "100% funcional"? | **Tudo que a origem entrega** — quando a origem cai, degrada com aviso visível, não lista vazia silenciosa |
| Instalados com a URL antiga? | **Corte seco — 404 no deploy** |
| Estrutura dos planos | **3 planos separados** |

## Baseline medido (03/10/2026)

### VOD — `plugin/tools/bateria-completa.js`, 11 fontes

```
com stream: 11/11 | lancou erro: 0 | devolveu vazio: 0 | contrato quebrado: 3
sem nenhum link vivo: 0 de 11 | sem qualidade real: 3 de 11
```

As 3 falhas de contrato, com a causa medida uma a uma:

| fonte | causa | nosso? |
|---|---|---|
| `blz` | probe resolve `1280x532` em **3423 ms**, `MS_SONDA = 3000` corta (`qualifica.js:36`) | **sim** |
| `ato` | origem devolve **235 B** de "Welcome to nginx!" para IP de datacenter | não — bloqueio de IP |
| `dgo` | segmento responde **`302` → `cloudflare-terms-of-service-abuse.com`** | não — bloqueio de IP |

Controle: `spc` resolve em 731 ms, `1920x800 -> 1080p`.

### TV — `plugin/tools/tv-cobertura.js`

Cobertura medida **39/60** (`{"rei":34,"emb":4,"etc":1}`). Fontes registradas em
`PROVIDERS_JOGADOR`: `rei`, `emb`, `etc`. **RCD fica de fora com medição** — a origem serve
PNG completo (IDAT+IEND) no lugar do vídeo.

### Segurança — postura atual

| Fato | Onde |
|---|---|
| URL de instalação **sem credencial nenhuma** | `install.html:231` e `:287` — `new URL(clean).host` **descarta o caminho** |
| `:config` é um segmento **existente e não validado** nas 4 rotas Stremio | `core/nomes.js:154-157` |
| Já encaminhado para `buildManifest` e `handleStreams` | `mirrorstream/src/server.js:1277`, `:1283` |
| `configurable: false` — o cliente não manda nada | `mirrorstream/src/server.js:166` |
| Rate limit 180 req/min/IP, Redis ou memória | `mirrorstream:1128`, `mirrorview:1312` |
| `trust proxy, 1` — `req.ip` é o cliente real | `mirrorstream:1040`, `mirrorview:1039` |
| **Bypass:** 20 000 chaves → `rateLimitMap.clear()` zera o contador de **todo mundo** | `mirrorstream:1159`, `mirrorview:1343` |
| O plugin **nunca chama nosso servidor** | verificado em `plugin/src` — só origens de terceiros + TMDB |
| `/nuvio/*` é o manifesto instalável do próprio mirrorview | `mirrorview/src/routes/nuvio.js` |

## Frente 1 — Fontes: tudo que a origem entrega

**Alcançável.** Toda fonte que a origem entrega, a gente entrega; quando a origem não entrega,
degrada com o motivo visível.

- Consertar o que é nosso (`blz` — orçamento da sonda).
- Classificar o que é da origem (`ato`, `dgo` — bloqueio de IP de datacenter) em vez de fingir.
- Nunca inventar qualidade: decisão 36 diz que a qualidade é a **resolução real lida do vídeo**.
- **Nunca perder fonte**: falha de sonda não remove stream.

**Fora de escopo, declarado:** fazer RCD tocar (origem serve PNG) e dar `quality` a `ato`/`dgo`
lendo uma resolução que não lemos.

→ `docs/superpowers/plans/2026-10-03-1-fontes-qualidade.md`

## Frente 2 — Scrapers robustos

Padronizar nos **três produtos** o que já existe em parte: timeout nomeado, retry, breaker e
**falha honesta** — rede/timeout/429/5xx **sobe erro**; `[]` só quando a origem **respondeu** e
não tem nada. Regra da decisão 131, que já custou327 → 217 canais por engolir 429.

→ `docs/superpowers/plans/2026-10-03-2-scrapers-robustos.md`

## Frente 3 — Segurança

### 3a. Portão de credencial

Um segmento opaco **na frente das rotas que já existem**, então nenhum padrão de rota muda:

```
https://host/<segredo>.<token>/manifest.json   → 200
https://host/manifest.json                     → 404 (não confirma que existe addon)
```

- `<token>` é emitido **por instalação** → revoga um sem derrubar os outros.
- `corte seco` no deploy (decisão do dono).
- Corrigir `install.html:231`/`:287`: `.host` **descartaria o caminho** e o botão Instalar
  furaria o portão.
- Bloquear o `/manifest.json` cru do `sdkRouter` (`server.js:1791`) e o `/nuvio/manifest.json`
  fixo (`nomes.js:172`).

### 3b. `/install` vira emissor

Só com a chave mestra do dono se gera um link. É o que faz o segredo ser segredo.

### 3c. Rate limit

Consertar o bypass: `rateLimitMap.clear()` vira evicção LRU (remove as mais antigas, nunca
zera tudo). Balde por credencial ao lado do balde por IP.

### O que este design NÃO garante, dito antes de implementar

- **Não para quem obteve o link de um usuário legítimo.** Por isso o token é por instalação e
  revogável.
- **O plugin não é afetado** — ele nunca chama nosso servidor.
- Com `corte seco`, **quem já instalou precisa reinstalar** no deploy. Esse custo foi aceito.

→ `docs/superpowers/plans/2026-10-03-3-seguranca.md`

## Como cada plano se prova

| Plano | Medição de aceitação |
|---|---|
| 1 | `cd plugin && node build.js && node tools/bateria-completa.js` → `contrato quebrado` só com `ato`/`dgo`, cada um com seu motivo |
| 2 | `node --test test/ mirrorstream/test/ mirrorview/test/ plugin/test/` verde + bateria sem erro |
| 3 | portão devolve 404 sem credencial; 200 com; rate limit não zera mais |
