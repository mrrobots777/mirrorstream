# CONTRATO — MirrorStream como plugin do Nuvio

## 1. Objetivo

O plugin resolve streams de filmes, séries, animes e doramas para o Nuvio. O catálogo e os metadados vêm do próprio Nuvio; o plugin recebe o identificador do título e devolve URLs jogáveis.

O repositório tem duas camadas: **fontes internas**, organizadas em `src/scrapers/` e registradas em `src/core/fontes/`, e a **interface pública**, um único scraper agregado chamado `mirrorstream`.

O manifesto público não lista cada fonte interna. Ele lista somente `mirrorstream.js`.

## 2. Contrato público do Nuvio

```js
module.exports.getStreams = async (tmdbId, mediaType, season, episode) => [];
```

Argumentos: `tmdbId` é uma string com ID TMDB; `mediaType` é `movie` ou `tv`; `season` e `episode` são números, `null` ou `undefined`.

Cada item retornado pode conter:

```js
{
  name: "☁️ MirrorStream",
  provider: "☁️ MirrorStream",
  url: "https://...",
  quality: "1080p",
  headers: { "Referer": "..." }
}
```

A resposta pública deve conter no máximo um item por qualidade normalizada. A ordem é da maior para a menor qualidade, seguida por `unknown` quando a resolução não pôde ser observada.

## 3. Agregação

`src/lib/agregador.js` recebe as listas das fontes internas e ignora resultados sem URL HTTP válida, normaliza `quality` com `src/lib/quality.js`, escolhe a primeira URL para cada qualidade, substitui `name` e `provider` por `☁️ MirrorStream` e ordena os itens por `qualityRank`.

Falha isolada de uma fonte não derruba as demais: o bundle agregado transforma essa falha em lista vazia e continua a consulta paralela.

## 4. Segurança do código

O bundle público roda dentro do aparelho do usuário. Logo, tudo que o Nuvio consegue executar pode ser copiado e analisado. Não existe separação segura entre “manifesto público” e “código fechado” quando o código precisa ser enviado ao cliente.

Para o modelo local: não publicar sourcemaps, manter o bundle minificado, não inserir segredos novos no cliente e rotacionar credenciais expostas. Minificação/ofuscação não é sigilo.

Se a exigência for código realmente fechado, o plugin público deve ser apenas um cliente e a API privada deve executar os scrapers:

```text
Nuvio → mirrorstream.js mínimo → API privada → scrapers e credenciais
```

Essa migração exige autenticação, rate limit, observabilidade, CORS e hospedagem persistente. É uma mudança de arquitetura, não apenas uma alteração no manifesto. Consulte `../SECURITY.md`.

## 5. Runtime do aparelho

O bundle não pode usar APIs arbitrárias do Node.js: `fs`, `path`, `http`, `https`, `process`, `Buffer`, `child_process`, DOM, storage do navegador, workers ou WebAssembly. Dependências de Node podem ser usadas pelo build, mas não podem escapar para o bundle final.

## 6. Build e artefatos

```bash
npm test
npm run build
npm run sandbox -- --sem-rede
```

O build gera bundles internos para validação, gera o bundle público agregado `dist/mirrorstream.js`, gera `dist/manifest.json` a partir do registro, copia o manifesto e o bundle para `public/` e remove bundles internos antigos de `public/`.

Artefatos públicos:

```text
public/manifest.json
public/mirrorstream.js
public/index.html
public/.nojekyll
```

## 7. Publicação e histórico

A branch pública é `master`. O repositório deve permanecer com um único commit consolidado quando solicitado pelo proprietário. O GitHub Actions valida o manifesto, verifica a existência do bundle e publica GitHub Pages.

URL de instalação:

```text
https://mrrobots777.github.io/mirrorstream/
```

## 8. Erros e qualidade

`[]` significa que não foi encontrado stream; erro isolado de fonte não impede as outras; URL morta não entra; qualidade não é inventada quando não foi medida; headers necessários permanecem no item; limites de corpo, tempo e concorrência do Nuvio devem ser respeitados.
