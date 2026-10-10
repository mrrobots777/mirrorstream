// Política única aplicada por todas as fontes através de src/lib/http.js.
const STATUS_RETRY_EDGE = Object.freeze([403, 408, 429, 500, 502, 503, 504]);
const WORKER_POR_HOST = Object.freeze({
  "animesonline.io": "https://mirror-aon.mr-caiomendonca.workers.dev",
  "anidrive.click": "https://mirror-aon.mr-caiomendonca.workers.dev",
  "www.anitube.biz": "https://mirror-atb.mr-caiomendonca.workers.dev",
  "anitube.biz": "https://mirror-atb.mr-caiomendonca.workers.dev",
  "redetoonstv.win": "https://mirror-rtd.mr-caiomendonca.workers.dev",
  "vizer.autos": "https://mirror-vzr.mr-caiomendonca.workers.dev"
});
// O fallback acima protege APIs. Este mapa é separado: uma URL de vídeo só passa pela
// borda quando o host de mídia é conhecido e o Worker correspondente está publicado.
const MEDIA_WORKER_POR_HOST = Object.freeze({
  "kakito.xyz": "https://mirror-blz.mr-caiomendonca.workers.dev",
  "telaplay93.top": "https://mirror-spc.mr-caiomendonca.workers.dev",
  "firetvcb.net": "https://mirror-ato.mr-caiomendonca.workers.dev",
  "4x4u29c.autos": "https://mirror-ato.mr-caiomendonca.workers.dev",
  "nsrv.classotaku.app": "https://mirror-shg.mr-caiomendonca.workers.dev",
  "cdn-sv01.maximaimg.online": "https://mirror-atb.mr-caiomendonca.workers.dev",
  "cdn-s01.mywallpaper-4k-image.net": "https://mirror-ron.mr-caiomendonca.workers.dev",
  "anitubehd2.dalayqnwpo.lol": "https://mirror-ise.mr-caiomendonca.workers.dev",
  "anitubefullhd.dalayqnwpo.lol": "https://mirror-ise.mr-caiomendonca.workers.dev",
  "anitubeiphonebb.dalayqnwpo.lol": "https://mirror-ise.mr-caiomendonca.workers.dev",
  "cdn.animestvs.org": "https://mirror-san.mr-caiomendonca.workers.dev",
  "redetoons.win": "https://mirror-rtd.mr-caiomendonca.workers.dev",
  "redetoonstv.win": "https://mirror-rtd.mr-caiomendonca.workers.dev",
  "forks-doramas.madfirebox.shop": "https://mirror-dgo.mr-caiomendonca.workers.dev",
  "ondemand.madfirebox.shop": "https://mirror-dgo.mr-caiomendonca.workers.dev"
});
const RETRIES = 1;
const BACKOFF_MS = 150;
function edgeAtivo() {
  return globalThis.MIRROR_EDGE_MODE !== "nunca";
}
// O worker so' repassa o `Referer` se ele vier no PARAMETRO `ref` da URL — ele ignora o
// cabecalho da requisicao. MEDIDO 08/10/2026: `mirror-rtd` responde **403** em
// `/proxy?url=…` e **200** com `&ref=https://redetoons.win/`. Sem isto o fallback do RTD
// estava morto: a origem direta falhava, o worker recebia a mesma recusa, e a fonte perdia
// as duas rotas.
//
// Por que isto e' AQUI e nao em cada fonte: o `Referer` que a origem exige ja viaja nos
// cabecalhos que o chamador passou para `pegar`, e a reserva nasce da MESMA chamada. Nao ha
// campo novo para preencher e nenhuma fonte pode esquecer — o `ref` sai de onde o
// `Referer` ja estava.
function workerDe(url, referer) {
  if (!edgeAtivo()) return null;
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    const base = WORKER_POR_HOST[host];
    if (!base) return null;
    const ref = String(referer || "").trim();
    return `${base}/proxy?url=${encodeURIComponent(String(url))}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`;
  } catch (_) {
    return null;
  }
}
function mediaWorkerDe(url, fonte, referer) {
  if (!edgeAtivo()) return null;
  try {
    const parsed = new URL(String(url));
    const base = MEDIA_WORKER_POR_HOST[parsed.hostname.toLowerCase()];
    if (!base) return null;
    const sigla = String(fonte || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const esperado = base.match(/mirror-([a-z0-9]+)\./i);
    if (sigla && esperado && sigla !== esperado[1].toLowerCase()) return null;
    const ref = String(referer || "").trim();
    // `media=1` mantém compatibilidade com Workers antigos: antes do deploy novo eles
    // caem no proxy existente, em vez de devolverem a página de ajuda de uma rota nova.
    return `${base}/proxy?media=1&url=${encodeURIComponent(String(url))}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`;
  } catch (_) {
    return null;
  }
}
function chaveResolucao(fonte, args) {
  const texto = `${String(fonte || "").toLowerCase()}|${JSON.stringify(Array.isArray(args) ? args.slice(0, 4) : [])}`;
  let hash = 2166136261;
  for (let i = 0; i < texto.length; i++) { hash ^= texto.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return `${String(fonte || "x").replace(/[^a-z0-9]/gi, "").toLowerCase() || "x"}-${(hash >>> 0).toString(36)}`;
}
function deveTentarEdge(status) {
  return STATUS_RETRY_EDGE.includes(Number(status));
}
// O gateway novo (spec §10): o aparelho não fala mais com o resolve Worker da Cloudflare.
// `GATEWAY_PADRAO` estava `""` até o serviço entrar no ar; foi gravado no passo 3 do
// deploy (spec §12) em 10/10/2026, quando `e75602c18409-gateway` passou a responder
// `/health` e `/resolve-batch`. Sem base, `resolveBatchUrl` devolve `null` e o bundle
// responde `[]` — essa defesa continua de pé para quem zere a constante.
// Nada de leitura de ambiente aqui: `plugin/src/**` é bundlado para um runtime sem `process`, e
// `simular-sandbox.js`/`runtime-aparelho.test.js` reprovam o token por regex — o override
// é `globalThis.MIRROR_GATEWAY`.
const GATEWAY_PADRAO = "https://e75602c18409-gateway.baby-beamup.club";   // passo 3 do deploy (spec §12)

function gatewayBase() {
  return globalThis.MIRROR_GATEWAY || GATEWAY_PADRAO || null;
}

function resolveBatchUrl(args, preferida) {
  const base = gatewayBase();
  if (!base || !Array.isArray(args) || !args[0]) return null;
  const tipo = args[1] || "movie";
  const temporada = args[2] === null || args[2] === undefined ? "-" : args[2];
  const episodio = args[3] === null || args[3] === undefined ? "-" : args[3];
  let url = `${base}/resolve-batch?id=${encodeURIComponent(String(args[0]))}&type=${encodeURIComponent(String(tipo))}&season=${encodeURIComponent(String(temporada))}&episode=${encodeURIComponent(String(episodio))}`;
  if (preferida) url += `&preferida=${encodeURIComponent(String(preferida))}`;
  return url;
}
module.exports = { BACKOFF_MS, RETRIES, STATUS_RETRY_EDGE, WORKER_POR_HOST, MEDIA_WORKER_POR_HOST, deveTentarEdge, edgeAtivo, workerDe, mediaWorkerDe, chaveResolucao, GATEWAY_PADRAO, gatewayBase, resolveBatchUrl };
