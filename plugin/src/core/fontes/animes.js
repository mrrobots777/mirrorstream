// FONTES DE ANIME — entradas cujo conteudo principal e' `anime`
// (`conteudos[0] === "anime"` => pasta `src/scrapers/animes/`).
// Aqui mora SÓ a entrada; ordem, merge e API publica ficam em `index.js`.

module.exports = {
  shg: {
    sigla: "SHG",
    arquivo: "otakulogia.js",
    tipos: ["movie", "tv"],
    conteudos: ["anime"],
    descricao: "Anime dublado PT-BR via SHG (otakulogia)"
  },
  ron: {
    sigla: "RON",
    arquivo: "animesdigital.js",
    tipos: ["movie", "tv"],
    conteudos: ["anime"],
    descricao: "Anime PT-BR/legendado via RON (animesdigital)"
  },
  atb: {
    sigla: "ATB",
    arquivo: "anitube.js",
    tipos: ["movie", "tv"],
    conteudos: ["anime"],
    descricao: "Anime PT-BR/legendado via ATB (anitube.biz)"
  },
  ise: {
    sigla: "ISE",
    arquivo: "isekai.js",
    tipos: ["tv"],
    conteudos: ["anime"],
    descricao: "Anime PT-BR via ISE (Isekai BR, MP4 por episódio)"
  },
  san: {
    sigla: "SAN",
    arquivo: "superanimes.js",
    tipos: ["tv"],
    conteudos: ["anime"],
    descricao: "Anime PT-BR via SAN (Super Animes, MP4 por episódio)"
  },
  rtd: {
    sigla: "RTD",
    arquivo: "redetoons.js",
    tipos: ["movie", "tv"],
    conteudos: ["anime", "filme", "serie"],
    descricao: "Filmes, séries e anime via RTD (RedeToons)",
    // MEDIDO 08/10/2026: a fonte foi desativada em 02/10 com o motivo "catalog/play-link
    // respondeu 403". A medicao estava errada — o 403 vinha da ROTA, nao da origem: sem o
    // `Referer: https://redetoons.win/` o `redetoonstv.win/api/catalog-index` responde 451,
    // e com ele responde 200 com 174 KB de indice (4.863 series + 21.006 filmes). O
    // `play-link?contract=3` devolve o contrato 3 e dois variants (dublado e legendado) em
    // `cnn.radiogaucha.fun`, que entrega `206 video/mp4` — MEDIDO 1280x960 lido do video.
    // Tres execucoes seguidas: 2 streams em 1,6 s / 2,1 s / 2,1 s. O scraper ja usava o
    // contrato oficial; o que faltava era o medidor que sobesse o `Referer`.
    idx: "rtd",
    // O RTD tem prefixo de shard mas NAO tem indice estatico de painel: o catalogo vem
    // da propria API dele (`/api/catalog-index`, 174 KB) e o scraper consulta se e o item
    // esta la. MEDIDO 08/10/2026: `fontesComIndice()` devolvia o RTD e o
    // `tools/publicacao/gerar-indice.js` montava `https://:/player_api.php?...` — sem
    // `servidor`/`usuario`/`senha`, porque o RTD nao e' painel Xtream — o que derrubava o
    // deploy inteiro. `painel: false` e' o que separa "prefixo de shard" de "fonte que o
    // gerador de shards consegue construir".
    painel: false
  },
};