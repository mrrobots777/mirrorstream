const { pegar } = require("./http");
const { UA } = require("./ua");

// Teto de UMA chamada ao painel. MEDIDO: BLZ `get_vod_info` leva 20 s (duas
// rodadas: 20,05 s e 19,94 s), SPC 0,05 s. Com 8 s o BLZ nunca entregava.
const MS_PADRAO = 26e3;

// MEDIDO 02/10/2026: o painel ATO recusa IP de datacenter — `player_api.php` responde
// `200` com a pagina "Welcome to nginx!" de 235 B (direto) e o MESMO pedido pelo worker
// `/proxy` devolve `200 application/json` de 2.307 B com o `get_vod_info` de verdade.
// A reserva e' o caminho do DETALHE, nunca do video: a URL do video continua saindo
// direto, e quem baixa e o aparelho. O worker e' derivado da sigla (`mirror-<sigla>`),
// igual ao registro do addon — o nome nunca e escrito a mao.
const WORKER_SUFIXO = "mr-caiomendonca.workers.dev";

function workerDe(sigla) {
  const limpa = String(sigla || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!limpa) return null;
  return `https://mirror-${limpa}.${WORKER_SUFIXO}`;
}

// O worker so' manda `Referer` se ele vier no parametro `ref` da URL — ele NAO repassa o
// cabecalho da requisicao. MEDIDO 08/10/2026 no RTD: `/proxy?url=…` sem `ref` devolve
// **403**, e com `&ref=https://redetoons.win/` devolve **200** em 334 ms. Sem este `ref`
// o fallback do RTD estava morto: quando a origem direta falhava, o worker recebia a
// mesma recusa que a origem deu, e a fonte perdia as duas rotas.
//
// O `Referer` correto de cada painel nao e' derivavel da API: o RTD so' responde com
// `https://redetoons.win/` (o dominio que saiu do ar), nao com o host que serve a API. Por
// isso o painel declara o seu em `referer`, e a reserva usa esse; sem o campo, cai no
// `Referer` da propria API, que e' o melhor palpite disponivel.
// Quando o painel nao declara `referer`, o melhor palpite e' a base da propria API — que e'
// o que quase todo painel aceita. O RTD e' a excecao medida: ele so' responde com o dominio
// `redetoons.win`, que e' diferente do host que serve a API, e por isso o declara.
function REFERER_PADRAO(painel) {
  return `${baseDe(painel)}/`;
}

function urlProxiada(sigla, url, referer) {
  const base = workerDe(sigla);
  if (!base) return null;
  const ref = String(referer || "").trim();
  return `${base}/proxy?url=${encodeURIComponent(url)}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`;
}

function baseDe(painel) {
  const porta = String(painel.porta || "443");
  const proto = porta === "80" ? "http" : "https";
  return `${proto}://${painel.servidor}:${porta}`;
}

function credencial(painel) {
  return `username=${encodeURIComponent(painel.usuario)}&password=${encodeURIComponent(painel.senha)}`;
}

function urlApi(painel, params) {
  const qs = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");
  return `${baseDe(painel)}/player_api.php?${credencial(painel)}&${qs}`;
}

function paginaDeErro(texto) {
  const primeiro = String(texto || "").slice(0, 200);
  return /welcome to nginx|<!doctype html|<html/i.test(primeiro);
}

// Quem ja recusou com a pagina de erro volta direto pela reserva: a recusa e politica da
// origem, nao um tropeco de rede, e pagar 2 requests por candidato em painel que nunca
// aceita este IP so atrasa o primeiro link da lista.
const recusaram = new Set();

async function le(url, ms, sigla) {
  const r = await pegar(url, { ms: Math.min(Number(ms) || MS_PADRAO, MS_PADRAO), headers: { Accept: "application/json", "User-Agent": UA } });
  if (r.status === 404) return { situacao: "nao-existe" };
  if (!r.ok) return { situacao: "recusa", motivo: `${sigla} player_api.php HTTP ${r.status}` };
  const texto = await r.text();
  if (!String(texto || "").trim()) return { situacao: "vazio" };
  try {
    return { situacao: "ok", json: JSON.parse(texto) };
  } catch (e) {
    // MEDIDO: o painel ATO responde `200` com a pagina "Welcome to nginx!" de 235 B
    // quando o cliente e um IP de datacenter — nao e JSON corrompido, e recusa de origem.
    if (paginaDeErro(texto)) {
      return { situacao: "recusa", refuga: true, motivo: `${sigla}: a origem devolveu pagina de erro (${texto.length} B), nao JSON — este IP foi recusado pelo painel` };
    }
    // JSON invalido que nao e pagina de erro = corpo cortado pelo teto de 1 MB do runtime.
    // O worker corta no mesmo teto, entao tentar de novo so gastaria o orcamento.
    return { situacao: "cortado", motivo: `${sigla}: resposta de ${url} nao e JSON valido (${String(texto || "").length} bytes — o teto de 1 MB do runtime corta aqui)` };
  }
}

// MEDIDO 02/10/2026: `get_vod_info` do BLZ responde em 20 s, o do SPC em 0,05 s e o
// do ATO nao responde direto deste IP (curl: 30 s sem resposta) — so pela reserva.
//
// A versao anterior pagava o timeout INTEIRO do pedido direto antes de tentar a
// reserva, e a fonte levava 9,8 s para entregar 2 streams. A versao de agora põe
// os dois EM PARALELO, com a reserva escalonada: a origem que responde rapido
// (SPC, 0,05 s) ganha sem gastar uma chamada no worker, e a origem que trava
// (ATO) nao espera o timeout inteiro — a reserva entra depois de MS_ESCALONA e
// responde em ~1 s, entao a fonte volta a ~3,5 s.
//
// O relogio NUNCA e limpo antes do `await` da outra ponta: limpar deixaria a
// reserva esperando um timer que ja nao existe, e o `await` nao voltaria nunca.
// Ele so e limpo quando ninguem mais precisa da outra ponta.
//
// `le` pode RECUSAR (timeout/rede), e uma recusa do direto nao pode derrubar a
// reserva — por isso as duas pontas viram resultado em vez de excecao, e so no fim
// (nenhuma das duas entregou) o erro sobe.
const MS_ESCALONA = 2.5e3;

function semEstouro(p, de) {
  return Promise.resolve(p).then(
    (r) => ({ r, de }),
    (e) => ({ r: { situacao: "recusa", motivo: `${de}: ${e && e.message ? e.message : e}` }, de })
  );
}

function entregou(r) {
  return r.situacao === "ok";
}

function naoExiste(r) {
  return r.situacao === "nao-existe" || r.situacao === "vazio";
}

async function api(painel, params, ms) {
  const url = urlApi(painel, params);
  const teto = Math.min(Number(ms) || MS_PADRAO, MS_PADRAO);
  const sigla = String(painel.sigla || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const reserva = urlProxiada(painel.sigla, url, painel.referer || REFERER_PADRAO(painel));

  // Origem que ja recusou com pagina de erro vai direto pela reserva.
  if (recusaram.has(sigla) && reserva) return soReserva(reserva, teto, painel.sigla);
  if (!reserva) return soDireto(url, teto, painel.sigla);

  const direto = semEstouro(le(url, teto, painel.sigla), "direto");
  let relogio = null;
  const escalona = new Promise((resolve) => {
    relogio = setTimeout(resolve, Math.min(MS_ESCALONA, teto));
  });
  const pelaReserva = semEstouro(escalona.then(() => le(reserva, teto, painel.sigla)), "reserva");

  const primeiro = await Promise.race([direto, pelaReserva]);
  if (entregou(primeiro.r)) {
    clearTimeout(relogio);
    return primeiro.r.json;
  }
  if (naoExiste(primeiro.r)) {
    clearTimeout(relogio);
    return null;
  }
  if (primeiro.r.refuga) recusaram.add(sigla);

  // O vencedor nao entregou: espera a outra ponta, que sempre resolve porque o
  // relogio continua rodando.
  const outra = primeiro.de === "direto" ? await pelaReserva : await direto;
  clearTimeout(relogio);
  if (entregou(outra.r)) return outra.r.json;
  if (primeiro.r.refuga && outra.de === "direto") recusaram.add(sigla);
  if (naoExiste(outra.r) || naoExiste(primeiro.r)) return null;
  if (primeiro.r.situacao === "cortado" || outra.r.situacao === "cortado") {
    throw new Error((primeiro.r.motivo || "") + " | " + (outra.r.motivo || ""));
  }
  throw new Error(primeiro.r.motivo || outra.r.motivo);
}

async function soDireto(url, teto, sigla) {
  const r = await le(url, teto, sigla);
  if (entregou(r)) return r.json;
  if (naoExiste(r)) return null;
  throw new Error(r.motivo);
}

async function soReserva(url, teto, sigla) {
  const r = await le(url, teto, sigla);
  if (entregou(r)) return r.json;
  if (naoExiste(r)) return null;
  throw new Error(r.motivo);
}


function infoDe(painel, id, ms) {
  return api(painel, { action: "get_vod_info", vod_id: id }, ms);
}

function infoDeSerie(painel, id, ms) {
  return api(painel, { action: "get_series_info", series_id: id }, ms);
}

// Escolhe a acao pelo tipo do conteudo. `fonte-painel` chama as duas por um caminho
// so, porque os detalhes sao pedidos EM PARALELO (ver CONC_DETALHE).
function detalheDe(painel, id, isTv, ms) {
  return isTv ? infoDeSerie(painel, id, ms) : infoDe(painel, id, ms);
}

function tmdbDe(info) {
  if (!info || typeof info !== "object") return null;
  const bloco = info.info && typeof info.info === "object" ? info.info : info;
  const bruto = bloco.tmdb_id !== undefined ? bloco.tmdb_id : bloco.tmdbId;
  const num = Number(String(bruto == null ? "" : bruto).replace(/[^0-9]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function nomeDe(info) {
  if (!info || typeof info !== "object") return "";
  const bloco = info.info && typeof info.info === "object" ? info.info : info;
  return String(bloco.name || bloco.o_name || bloco.title || "");
}

function urlDoFilme(painel, streamId, ext) {
  return `${baseDe(painel)}/movie/${encodeURIComponent(painel.usuario)}/${encodeURIComponent(painel.senha)}/${streamId}.${ext || "mp4"}`;
}

function urlDoEpisodio(painel, streamId, ext) {
  return `${baseDe(painel)}/series/${encodeURIComponent(painel.usuario)}/${encodeURIComponent(painel.senha)}/${streamId}.${ext || "mp4"}`;
}

function episodiosDe(info, temporada, episodio) {
  const eps = info && info.episodes && typeof info.episodes === "object" ? info.episodes : {};
  const lista = eps[String(temporada)] || eps[temporada] || [];
  if (!Array.isArray(lista)) return null;
  const alvo = Number(episodio) || 1;
  const validos = lista.filter((e) => e && e.id !== undefined && e.id !== null);
  const porNumero = validos.filter((e) => Number(e.episode_num) === alvo);
  if (porNumero.length) return porNumero[0];
  const semNumero = validos.filter((e) => e.episode_num === undefined || e.episode_num === null || e.episode_num === "");
  if (semNumero.length === alvo) return semNumero[alvo - 1];
  return semNumero[0] || null;
}

module.exports = {
  MS_PADRAO,
  api,
  baseDe,
  credencial,
  detalheDe,
  episodiosDe,
  infoDe,
  infoDeSerie,
  nomeDe,
  tmdbDe,
  urlApi,
  urlDoEpisodio,
  urlDoFilme,
  urlProxiada,
  workerDe
};
