"use strict";

// Superfície Stremio do gateway.
//
// Motivo: o BeamUp não é um PaaS genérico — "It only supports Stremio addons".
// O `beamup-lint` recusa o deploy no pre-flight com
// "is not a valid Stremio addon, refusing to deploy it". Para o gateway subir
// lá ele precisa SER um addon Stremio, e ser um de verdade: manifesto que o
// `stremio-addon-linter` valida e endpoint `/stream/...` que responde.
//
// O que isto NÃO é: o consumo real continua `/resolve-batch` pelo plugin
// MirrorStream no aparelho. Ninguém vai instalar este addon no Stremio — as
// rotas existem para o gate da plataforma e para o manifesto não mentir sobre
// `resources: ["stream"]`.
//
// Zero dependência npm (regra do repo): o manifesto não é validado em runtime
// pelo linter da Stremio — os campos abaixo são os que `lib/linter.js` exige
// (`id`/`name` string, `version` semver, `resources`/`types`/`catalogs` array)
// e `gateway/test/stremio.test.js` os aserta um a um.
//
// Format: /stream/{tipo}:{id}[:{temporada}:{episodio}].json
//   movie:tt0133093              → id tt0133093
//   series:tt0903747:1:1         → id tt0903747, S01E01
//   movie:tmdb:603               → id tmdb:603  (id TEM dois-pontos dentro)

// O protocolo Stremio chama de `series`; o registro de fontes do gateway chama
// de `tv`. O parse entrega o nome que o `resolve` entende.
const TIPO_STREMIO = { movie: "movie", series: "tv" };

const manifest = Object.freeze({
  id: "club.mirrorstream.gateway",
  name: "MirrorStream Gateway",
  version: "1.0.0",
  description: "Resolve streams do MirrorStream para movie e series",
  types: ["movie", "series"],
  resources: ["stream"],
  catalogs: [],
  idPrefixes: ["tt", "tmdb:"],
  behaviorHints: { configurable: false, p2p: false },
});

// `"series:tt0903747:1:1"` → `{ tipo: "tv", id: "tt0903747", temporada: 1, episodio: 1 }`.
// Devolve `null` para qualquer coisa que não seja um pedido válido — quem chama
// decide o status (400), aqui não há resposta HTTP.
function parseiaStream(caminho) {
  if (typeof caminho !== "string") return null;
  const corte = caminho.indexOf(":");
  if (corte <= 0) return null;
  const tipo = TIPO_STREMIO[caminho.slice(0, corte)];
  if (!tipo) return null;                          // `serie:`, `anime:`, …

  const resto = caminho.slice(corte + 1);
  if (!resto) return null;

  let id = resto;
  let temporada = null;
  let episodio = null;

  // Em série, os DOIS últimos segmentos numéricos são temporada e episódio.
  // Numéricos mesmo: `series:tt0903747:1:1` sim, mas um id que termine em
  // `:parte1` não pode ser cortado no meio.
  if (tipo === "tv") {
    const pedacos = resto.split(":");
    const fim = pedacos[pedacos.length - 1];
    const penult = pedacos[pedacos.length - 2];
    if (pedacos.length >= 3 && /^\d+$/.test(fim) && /^\d+$/.test(penult)) {
      episodio = Number(fim);
      temporada = Number(penult);
      id = pedacos.slice(0, -2).join(":");         // preserva `tmdb:1234`
    }
  }

  if (!id) return null;
  return { tipo, id, temporada, episodio };
}

// Item do gateway → item Stremio. O gateway segue o formato do plugin
// (`headers` solto, `behaviorHints.bingeGroup`); o Stremio lê header de play
// em `behaviorHints.proxyHeaders.request`, sem `headers` solto no item.
// Item sem `url` não é stream para o Stremio — sai como `null` e quem chama
// filtra.
function paraStremio(item) {
  if (!item || typeof item !== "object") return null;

  const bruto = item.url;
  const url = typeof bruto === "object" && bruto ? bruto.url : bruto;
  if (typeof url !== "string" || url === "") return null;

  const hints = (item.behaviorHints && typeof item.behaviorHints === "object")
    ? { ...item.behaviorHints }
    : {};

  const headers = (item.headers && typeof item.headers === "object" && Object.keys(item.headers).length)
    ? item.headers
    : (hints.proxyHeaders && hints.proxyHeaders.request);
  if (headers && typeof headers === "object" && Object.keys(headers).length) {
    hints.proxyHeaders = { ...(hints.proxyHeaders || {}), request: headers };
  }

  const saida = { url };
  if (typeof item.name === "string" && item.name) saida.name = item.name;
  if (typeof item.title === "string" && item.title) saida.title = item.title;
  saida.behaviorHints = hints;
  return saida;
}

module.exports = { manifest, parseiaStream, paraStremio };
