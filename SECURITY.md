# Segurança e proteção do código

## Resumo

O manifesto pode ser público, mas o código que o Nuvio executa não pode ser secreto. O aparelho precisa baixar o JavaScript para executá-lo; portanto, o usuário consegue obter, inspecionar e instrumentar esse arquivo.

O estado atual usa:

```text
manifesto público → mirrorstream.js público → fontes consultadas pelo aparelho
```

Isso protege a organização visual do plugin — o Nuvio mostra uma única fonte — e agora aplica ofuscação ao bundle agregado, mas a ofuscação **não protege o código contra análise determinada**.

## O que não resolve

As medidas abaixo dificultam leitura casual, mas não fecham o código: separar o manifesto do bundle, minificar JavaScript, ofuscar nomes, remover comentários, esconder o arquivo atrás de uma URL difícil ou usar GitHub Pages privado enquanto o Nuvio ainda precisa baixar o arquivo.

O build atual ofusca `public/mirrorstream.js` com nomes hexadecimais, strings codificadas e sem sourcemap. O bundle foi validado carregando no runtime simulado do Nuvio. Isso aumenta o tamanho e o custo de depuração, e pode ser revertido se uma versão do app apresentar incompatibilidade.

Também é inadequado colocar credenciais no bundle esperando que a ofuscação as proteja.

## Arquitetura para código privado

A única proteção real é não enviar os scrapers ao aparelho:

```text
Nuvio
  ↓ HTTPS
plugin público mínimo
  ↓ HTTPS autenticado
API privada MirrorStream
  ├── scrapers privados
  ├── credenciais privadas
  ├── agregação por qualidade
  └── rate limit / logs / bloqueio de abuso
```

O plugin público envia `tmdbId`, `mediaType`, `season` e `episode`. A API executa os scrapers e retorna somente os players finais:

```json
[
  {
    "name": "☁️ MirrorStream",
    "provider": "☁️ MirrorStream",
    "url": "https://...",
    "quality": "1080p"
  }
]
```

## Plano de migração recomendado

1. Rotacionar credenciais já publicadas em bundles antigos.
2. Criar uma API privada com endpoint de streams.
3. Implementar autenticação por instalação, token de curta duração ou mecanismo equivalente.
4. Mover scrapers, regras de matching e credenciais para o servidor.
5. Fazer o bundle público chamar somente a API.
6. Manter o agregador no servidor para não enviar duplicatas ao Nuvio.
7. Adicionar rate limit, logs sem URLs sensíveis e monitoramento.
8. Testar Android, Linux/desktop e falha da API.
9. Só então remover as fontes do bundle público.

## Decisão atual

O projeto permanece no modelo local porque ele permite que o Nuvio faça as requisições diretamente e não exige uma API persistente. O código não é considerado secreto nesse modelo. A migração para API privada deve ser tratada como um projeto separado de infraestrutura e segurança.
