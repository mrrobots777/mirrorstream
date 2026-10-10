# MirrorStream — plugin VOD do Nuvio

## Instalação

No Nuvio, abra **Settings → Plugins → Add repository URL** e informe:

```text
https://mrrobots777.github.io/mirrorstream/
```

Se uma versão antiga estiver em cache, remova e adicione novamente o repositório.

## Modelo público

O Nuvio instala e exibe **um único scraper: `☁️ MirrorStream`**. O bundle consulta as fontes internas em paralelo e devolve no máximo um player por qualidade (`360p`, `480p`, `720p`, `1080p`, `1440p`, `2160p` ou `unknown`). Duplicatas da mesma qualidade são removidas e o nome da fonte interna não aparece na tela.

O GitHub Pages publica somente o manifesto e o bundle agregado:

```text
public/manifest.json
public/mirrorstream.js
```

## Segurança

O bundle é executado no aparelho do usuário e, por isso, precisa ser baixado pelo Nuvio. O build ofusca `public/mirrorstream.js` sem sourcemap para dificultar leitura casual, mas isso não é sigilo criptográfico: uma pessoa determinada ainda pode extrair e analisar o JavaScript. Não coloque credenciais no bundle. Para código realmente privado, use uma API remota; consulte [`../SECURITY.md`](../SECURITY.md).

## Velocidade

O caminho agregado usa o mesmo padrão eficiente dos addons de servidor, adaptado para rodar localmente: as fontes compatíveis entram em um rodízio de até cinco por consulta, chamadas iguais durante o mesmo instante são coalescidas, e resultados ficam em cache na memória do processo do Nuvio por até cinco minutos. Cada fonte tem no máximo uma execução simultânea, timeout próprio de 8 segundos, cooldown após falhas repetidas e circuit breaker temporário. A primeira resposta tem teto de 12 segundos para que retries de uma origem lenta não prendam o usuário por um minuto; o enriquecimento de qualidade continua em paralelo e alimenta o cache para a próxima abertura. A regra do resultado é um player por combinação de qualidade e tipo (Dublado/Legendado), sem ocultar links quando a origem não fornece metadados. Cada player também recebe `behaviorHints.bingeGroup = "mirrorstream:<fonte>"`; o Nuvio salva esse grupo quando o usuário inicia a reprodução e pode reutilizá-lo no próximo episódio. `globalThis.MIRROR_QUALIDADE = "nunca"` desliga a sondagem real para priorizar somente a velocidade.

Quando o Nuvio envia a preferência salva (`preferredBingeGroup`, `bingeGroup`, `preferredSource` ou `sourceId`), o agregado entra no caminho rápido: consulta primeiro somente a fonte correspondente por até seis segundos. Se ela falhar ou não entregar links, até duas fontes reserva são consultadas dentro do orçamento normal. A preferência também faz parte da chave do cache, portanto um resultado da fonte escolhida não é confundido com o resultado do rodízio. Argumentos de controle são consumidos pelo agregado e não são repassados aos scrapers internos.

## Desenvolvimento

```bash
npm ci --no-audit --no-fund
npm test
npm run build
npm run sandbox -- --sem-rede
```

O build gera o manifesto de `src/core/fontes/`, o bundle público `mirrorstream.js` e os arquivos do GitHub Pages. O teste de sandbox simula o runtime do Nuvio, sem Node.js, DOM ou APIs proibidas.

## Organização interna

As fontes internas continuam em `src/scrapers/<categoria>/` e são registradas em `src/core/fontes/`. Elas são detalhes de implementação: não são scrapers separados no manifesto público.

A documentação técnica completa está em [`CONTRATO.md`](CONTRATO.md). O histórico e o plano de proteção estão em [`../SECURITY.md`](../SECURITY.md).
