# `scrapers/series/` — pasta vazia, de propósito

Esta pasta existe e não tem nenhum scraper. Isso é uma propriedade verificada por teste
(`test/categorias.test.js`), não um accidento: **uma pasta de categoria vazia é um estado
legítimo**, e o registro atual não tem nenhuma fonte com `serie` como categoria principal.

## Por que a pasta existe mesmo vazia

Os scrapers vivem na pasta da sua **categoria principal**, e essa categoria é derivada do
primeiro item de `conteudos` no registro (`fontes.diretorioDe`). A regra vale para toda fonte,
então as quatro pastas existem — mesmo quando uma não tem fonte.

Uma pasta ausente seria ambígua: "ninguémyetém série" e "alguém esqueceu de criar a pasta" são
a mesma coisa no disco. O README e o teste tiram a ambiguidade.

## O que fazer quando a primeira fonte de série entrar

1. Escreva o scraper em `plugin/src/scrapers/series/<nome>.js`.
2. Registre a fonte com **`conteudos: ["serie", …]`** — `serie` **primeiro**, porque é o que
   decide a pasta. Uma fonte de série que também é anime (`["anime", "serie"]`) vai para
   `animes/`, e isso é intencional: só uma pasta por fonte.
3. Nada mais. O caminho, o `manifest.json`, o build e as medições por categoria saem do
   registro — não há lista de arquivos para manter em sincronia.

O teste que garante a regra:

```bash
cd plugin && node --test test/categorias.test.js
```

Ele falha se um `.js` aparecer aqui sem `conteudos[0] === "serie"`, e falha se a pasta sumir.