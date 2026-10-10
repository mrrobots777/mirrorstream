# Política de fontes

Como uma fonte entra, como sai, e como se lê o que a medição diz. Vale para toda fonte nova e
para toda queda de fonte.

## 1. O critério de entrada

Uma fonte só entra no registro se passar **todas** as três:

1. **Link verificável e reimplementável.** O scraper reimplementa uma regra de parse de um
   endpoint público. Se o "link" depende de token por host, de backends de terceiro ou de
   sessão, não entra — ver [`2026-10-08-fenixflix-estudo.md`](2026-10-08-fenixflix-estudo.md),
   um caso medido em que o addon declarava `stream` e mesmo assim não tinha nada a extrair.
2. **Medido, não suposto.** Passou por `tools/medicao/bateria.js` com ao menos um título real e
   link vivo. "A página abriu" não é medição.
3. **Contrato do aparelho.** Carrega no `tools/validacao/simular-sandbox.js` e exporta
   `getStreams(tmdbId, mediaType, season, episode)` sem nada de Node no caminho.

## 2. O critério de saída

Uma fonte sai do registro (`ativo: false`) com **motivo e data** no próprio registro, nunca em
silêncio. Motivos que derrubam fonte:

- a origem fechou ou mudou o parse sem aviso;
- a medição repetida dá link morto em títulos que já deram certo;
- a manutenção ficou acima do que a fonte entrega;
- a licença ou os termos da origem mudaram.

Fontes desligadas **continuam registradas**. O registro é também o arquivo do que já foi
tentado: uma fonte desligada ensina mais que uma fonte apagada.

## 3. Como ler uma falha

**403, 429, DNS, expiração de CDN e bloqueio por IP são falha da origem externa, não do
plugin.** Isso não é desculpa: é a linha entre "o scraper está errado" e "a origem recusou
nosso IP". A regra prática:

| sintoma | de quem é a culpa | o que o plugin faz |
|---|---|---|
| `403` constante | origem recusando IP de datacenter | tenta o worker da fonte, se houver; declara `BLOQUEADO` |
| `429` | limite de taxa da origem | baixa concorrência; declara `INDECISO` |
| link responde e expira | CDN da origem | `SEM-LINK`, com a URL na medição |
| parse quebrou, resposta muda de forma | scraper | corrige-se o scraper; é falha nossa |
| `0` streams com a origem de pé | scraper | corrige-se o scraper; é falha nossa |

**A única linha que este projeto não cruza é mascarar falha como sucesso.** Um `[]` devolvido
por erro de rede é pior que um `[]` honesto: o dono não sabe o que procurar. Daí `INDECISO` e
`BLOQUEADO` existirem como vereditos separados de `MORTO` — a régua do aparelho (decisões
131/134) aplicada à medição, senão a bateria acusa de morta uma fonte que o celular do dono vai
tocar sem problema.

## 4. Cobertura por categoria

O registro declara as fontes por categoria. A contagem **vem do registro**, nunca de um número
escrito à mão:

| categoria | declaradas | ativas |
|---|---|---|
| `animes/` | 9 | SHG, RON, ATB, ISE, SAN, RTD |
| `filmes/` | 5 | BLZ, SPC, ATO |
| `series/` | 0 | — |
| `doramas/` | 1 | DGO |

A pasta `series/` existe e está vazia de propósito: nenhuma fonte tem `serie` como categoria
principal. Quando a primeira aparecer, a regra é a mesma das outras — a pasta é derivada de
`conteudos[0]`, não escolhida à mão.

## 5. Como uma medição se lê

```bash
cd plugin
FONTES=shg,dgo PROBE_MAX=1 node tools/medicao/bateria.js
```

A saída vem **por fonte** (quem quebrou, com a URL) e **por categoria** (`animes 6/9 | …`,
`medicao/resumo.js`) — a segunda linha é a que responde "a categoria está de pé?". As duas
existem porque elas respondem perguntas diferentes, e uma medição que só dá a primeira obriga
quem lê a somar de cabeça.

## 6. Origens já avaliadas

Estudos completos, com a cadeia inteira executada:

| origem | data | veredito | em uma frase |
|---|---|---|---|
| [FenixFlix](2026-10-08-fenixflix-estudo.md) | 08/10/2026 | descartada | token `?hash=` **por host**; o mesmo hash em outro backend dá 404 — não é reimplementável |
| [EmbedPlayApi](2026-10-08-embedplayapi-estudo.md) | 08/10/2026 | descartada como fonte | 7 saltos e o último exige **desafio interativo** do Cloudflare; cobertura 4/10 em anime e dorama |
| [EmbedMovies](2026-10-08-embedmovies-estudo.md) | 08/10/2026 | descartada | o operador declara **somente iframe**; a página não tem um único `m3u8`/`mp4` |

Duas das três **passavam** nos critérios 1 e 2 — API pública, documentada, `robots.txt`
liberado, medida de verdade. As duas caíram no 1 ou no 3, e é sempre o mesmo par de
obstáculos: **o aparelho não tem navegador**, e **`url` no Nuvio tem de ser mídia, não página**.

O que sobrou do EmbedPlayApi foi aproveitado em parte, como catálogo e não como fonte: ver a
§5 do estudo.

### Como não desperdiçar tempo na próxima

A ordem de leitura que economiza dias:

1. **A documentação do serviço promete link direto?** É o requisito nº1. Se o serviço diz
   "somente via iframe" (EmbedMovies), o estudo cabe em uma página — foi o que aconteceu.
2. **Rode a cadeia inteira uma vez, de `curl`, sem navegador**, e veja onde ela termina. Se
   terminar em `Just a moment…` do Cloudflare (EmbedPlayApi), acabou.
3. **Só então** meça cobertura por obra, em pelo menos 10 títulos da categoria difícil.