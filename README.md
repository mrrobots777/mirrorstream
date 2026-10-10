# MirrorStream — plugin VOD do Nuvio

Plugin VOD para o app **Nuvio**, com um único provedor público e consolidação de streams por qualidade.

## Instalação

No Nuvio, abra **Settings → Plugins → Add repository URL** e informe:

```text
https://mrrobots777.github.io/mirrorstream/
```

Depois de uma atualização, remova e adicione novamente o repositório se o Nuvio estiver usando uma versão antiga em cache.

## Comportamento no Nuvio

O manifesto público declara somente um scraper:

```text
☁️ MirrorStream
```

Internamente, o bundle consulta as fontes VOD disponíveis em paralelo. Antes de devolver a resposta ao app, ele elimina links sem URL HTTP, normaliza a qualidade, mantém no máximo um player por qualidade, conserva a primeira URL válida encontrada e identifica `name` e `provider` como `☁️ MirrorStream`.

Assim, o usuário não vê uma lista repetida de fontes. Ele vê uma única fonte com os players disponíveis para o título.

## Segurança e privacidade do código

### O que é público hoje

O GitHub Pages serve `manifest.json`, `mirrorstream.js` e os arquivos auxiliares do Pages. Como o Nuvio executa o scraper **no aparelho do usuário**, o JavaScript precisa ser entregue ao aparelho. Portanto, não é possível manter esse código realmente fechado usando apenas um manifesto separado: se o app consegue executar o código, uma pessoa com acesso ao aparelho pode baixar, inspecionar, descompilar ou instrumentar o bundle.

Minificação, ofuscação e remoção de sourcemaps apenas aumentam o trabalho de leitura; não são proteção criptográfica. Não devem ser usadas para esconder chaves, senhas ou credenciais.

### Arquitetura realmente privada

Para manter a implementação e as credenciais no servidor, o desenho correto é:

```text
Nuvio → plugin público mínimo → API privada MirrorStream → fontes VOD
                         └── manifesto público
```

O manifesto continua público, o plugin público contém apenas um cliente HTTP mínimo, a API privada executa os scrapers e o Nuvio recebe somente a lista final de players por qualidade. Essa migração exige hospedagem de API, autenticação/rate limit, monitoramento e CORS. Também muda a origem das requisições: as fontes passam a ver o IP do servidor.

**Recomendação:** não colocar novas credenciais no bundle público. Rotacione credenciais que já tenham sido publicadas em bundles anteriores. O plano está em [`SECURITY.md`](SECURITY.md).

## Gateway

O caminho de resolução de hoje é esse desenho: o bundle agregado é um cliente fino do **gateway
MirrorStream**, serviço Node 18+ com zero dependência npm em `gateway/`. O aparelho faz um
único `fetch` e devolve `body.streams`; sem gateway configurado, devolve `[]` — não há
fallback para Workers de resolução nem para scrapers locais.

Rotas (todas GET, com `access-control-allow-origin: *`, inclusive nos erros):

- `GET /resolve-batch` — `id`, `type` (e `season`/`episode`/`preferida` quando houver).
  Cache em memória: 5 min (positivo completo), 15 s (parcial), 30 s (negativo). Quem não tem
  o título recebe 200 com `streams: []`, nunca 404.
- `GET /health` — prontidão e contagens de fonte/cache, sempre `cache-control: no-store`.
- `GET /metrics` — contadores no formato Prometheus, também `no-store`.
- `GET /manifest.json` e `GET /stream/{tipo}:{id}[:{s}:{e}].json` — superfície Stremio. O
  BeamUp só publica addons Stremio e o `beamup-lint` recusa o deploy de qualquer outra coisa,
  então o gateway é um addon de verdade (manifesto validado pelo `stremio-addon-linter`
  oficial) cujo `/stream/...` chama o mesmo `resolve` do `/resolve-batch`. **Ninguém vai
  instalar este addon**: o consumo real continua sendo o plugin em `/resolve-batch`; as duas
  rotas existem para o gate da plataforma passar e para o manifesto não mentir sobre
  `resources: ["stream"]`.

A URL pública do serviço está gravada em `GATEWAY_PADRAO` (`plugin/src/core/politica.js`) —
`https://e75602c18409-gateway.baby-beamup.club`, escrita no passo 3 do deploy em 10/10/2026.
Se alguém zerar a constante, `resolveBatchUrl` devolve `null` e o bundle volta a responder
`[]`; é essa a defesa que o teste `"a base vem de GATEWAY_PADRAO"` segura. O override de teste
é `globalThis.MIRROR_GATEWAY` — `process.env` não existe no runtime do aparelho e o sandbox
reprova o token por regex. Os Workers da Cloudflare permanecem apenas como relay de mídia
(`/proxy?media=1`).

## Estrutura

```text
.
├── docs/                       # estudos, política de fontes e arquitetura
├── gateway/                    # serviço de resolução (Node 18+, sem dependências npm)
├── infra/                      # workers e infraestrutura auxiliar
├── plugin/
│   ├── src/core/fontes/        # registro interno das fontes
│   ├── src/lib/                # agregador, qualidade, rede e utilitários
│   ├── src/scrapers/           # implementações internas das fontes
│   ├── tools/                  # validação, medição e publicação
│   ├── public/                 # artefato servido pelo GitHub Pages
│   ├── build.js                # gera o bundle e o manifesto
│   └── CONTRATO.md             # contrato técnico atualizado
└── SECURITY.md                 # modelo de ameaça e plano de migração
```

O código interno continua organizado por fonte, mas o manifesto público não expõe essas fontes individualmente.

## Desenvolvimento

```bash
cd plugin
npm ci --no-audit --no-fund
npm test
npm run build
npm run sandbox -- --sem-rede
```

`npm test` valida o runtime do aparelho e o agregador. `npm run build` gera o `manifest.json` e o bundle público `mirrorstream.js`. O GitHub Actions executa o build, valida o artefato e publica `plugin/public` no GitHub Pages.

A suíte do gateway roda separada, sem dependência npm:

```bash
cd gateway
node --test test/*.test.js
```

## Publicação

O repositório mantém uma única branch de trabalho/publicação: `master`. O workflow de Pages publica automaticamente após cada push em `master`.

Artefatos públicos esperados:

```text
public/manifest.json
public/mirrorstream.js
public/index.html
public/.nojekyll
```

## Limites conhecidos

- O plugin precisa rodar no Android, Linux/desktop e demais runtimes suportados pelo Nuvio.
- O runtime do aparelho não oferece APIs arbitrárias do Node.js.
- Cada chamada deve respeitar os limites de tempo e tamanho de resposta do Nuvio.
- Uma origem pode retornar 403, 404, 429, expirar links ou bloquear IP; isso é diferente de uma falha do agregador.
- Qualidade desconhecida continua sendo reportada como uma única entrada `unknown`, sem inventar resolução.
