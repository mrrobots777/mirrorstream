const { pegarJson } = require("./http");
const { idDe, pareceImdb } = require("./id-de-conteudo");
const memo = new Map();

// O ID QUE O APP ENTREGA, medido 02/10/2026.
//
// O dono: *"nao e' para ter catalogo, o addon e' chamado quando o usuario entra em um vod do
// cinameta ai as fontes sao buscadas via imdb"*. O Cinetmeta resolve a meta por IMDb, entao o id
// que chega em `getStreams` e' `tt0133093` — NAO `603`.
//
// Antes desta funcao, `chaveDoId` tirava o que nao era digito e `tt0133093` virava `0133093`.
// As 7 fontes de VOD entao buscavam **"Strings" (2012)** no lugar de "The Matrix", nao casavam
// com nada e devolviam `[]` sem erro — que o Nuvio le como "nenhuma fonte". Medido antes/depois:
//
//     SPT tt0133093 -> 0 (603 -> 1)     VZR tt0133093 -> 0 (603 -> 1)
//     RTD tt0133093 -> 0 (603 -> 1)     BLZ tt0133093 -> 0 (603 -> 1)   SPC 0 (603 -> 2)
//
// A conversao e' `/find/{imdb_id}?external_source=imdb_id`, e ela e' do TMDB — nao nossa. O que
// e' nosso e' a REGRA: um id so' e' consultado como TMDB depois de resolvido, e o `movie_results`
// vence o `tv_results` so' quando o pedido e' de filme (o inverso nao acontece: uma serie nunca
// volta em `movie_results`).
//
// O sufixo de serie (`tt0903747:1:1`) e' preservado: `temporada`/`episodio` vem em argumentos
// separados e o id so' precisa do `tt0903747`.
function idCanonico(valor) {
  const bruto = String(valor == null ? "" : valor).trim();
  const semSufixo = bruto.replace(/:\d+:\d+$/, "");
  if (pareceImdb(bruto)) return { imdb: semSufixo, tmdb: null };
  return { imdb: null, tmdb: idDe(bruto) };
}

function chaveDoId(tmdbId) {
  return idCanonico(tmdbId).tmdb;
}

// IMDb -> TMDB. `eSerie` desempata quando o titulo existe nos dois lados (raro, mas o
// endpoint devolve os dois arrays). Com `eSerie=false` preferimos `movie_results`.
async function resolveImdb(imdb, eSerie, chave) {
  const memoChave = `find:${imdb}:${eSerie ? "tv" : "movie"}`;
  if (memo.has(memoChave)) return memo.get(memoChave);
  // Guardar a Promise imediatamente evita que as fontes agregadas façam 9 requests
  // iguais quando o Nuvio abre um título por IMDb pela primeira vez.
  const pendente = buscaJson(`/find/${imdb}`, chave, { external_source: "imdb_id" })
    .then((dados) => {
      const filmes = (dados && dados.movie_results) || [];
      const series = (dados && dados.tv_results) || [];
      const escolhido = eSerie ? (series[0] || filmes[0]) : (filmes[0] || series[0]);
      const id = escolhido ? String(escolhido.id) : null;
      memo.set(memoChave, id);
      return id;
    })
    .catch((erro) => {
      memo.delete(memoChave);
      throw erro;
    });
  memo.set(memoChave, pendente);
  return pendente;
}
function chaveApi() {
  const chave = globalThis.TMDB_API_KEY;
  if (!chave || !String(chave).trim()) {
    throw new Error("TMDB_API_KEY ausente: defina globalThis.TMDB_API_KEY antes de chamar tituloDe");
  }
  return String(chave).trim();
}
function anoDe(data) {
  const m = String(data || "").match(/^(\d{4})/);
  return m ? m[1] : null;
}
async function buscaJson(caminho, chave, params) {
  const extra = params
    ? Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")
    : "";
  // O separador e' `?` quando a URL AINDA nao tem query, e `&` quando ja tem. A versao
  // anterior nao tinha `params`; com ele, um erro aqui produz
  // `/find/tt0133093&api_key=…` — sem `?`, o TMDB responde **401** e a fonte LANCA.
  const sep = caminho.includes("?") ? "&" : "?";
  const url =
    `https://api.themoviedb.org/3${caminho}${sep}api_key=${encodeURIComponent(chave)}` +
    (extra ? `&${extra}` : "");
  const r = await pegarJson(url, { ms: 8e3 });
  if (r.status === 404) return null;
  if (!r.ok || !r.dados) throw new Error(`TMDB ${r.status || "?"} em ${caminho}`);
  if (r.dados.success === false) throw new Error(`TMDB recusou ${caminho}: ${r.dados.status_message || "erro"}`);
  return r.dados;
}
async function tituloDe(tmdbId, tipo, temp, ep) {
  const canonico = idCanonico(tmdbId);
  const chave = chaveApi();
  const eSerie = String(tipo || "").toLowerCase() === "tv";
  // O id so' vira "consulta de TMDB" depois de resolvido. Um id que nao e' nem IMDb nem TMDB
  // e' erro de contrato do chamador (nao "a fonte nao tem o titulo"), por isso LANCA.
  let id = canonico.tmdb;
  if (!id && canonico.imdb) id = await resolveImdb(canonico.imdb, eSerie, chave);
  if (!id) throw new Error(`tituloDe: id nao reconhecido ("${String(tmdbId)}") — nem IMDb (tt…) nem TMDB`);
  const s = Number(temp);
  const e = Number(ep);
  const comEpisodio = eSerie && temp !== null && temp !== void 0 && ep !== null && ep !== void 0 && Number.isFinite(s) && Number.isFinite(e);
  const memoChave = `${eSerie ? "tv" : "movie"}:${id}:${comEpisodio ? `${s}:${e}` : "-"}`;
  if (memo.has(memoChave)) return memo.get(memoChave);
  const pendente = (async () => {
    const base = await buscaJson(eSerie ? `/tv/${id}` : `/movie/${id}`, chave);
    if (!base) return null;
    const saida = {
      titulo: base.title || base.name || null,
      original: base.original_title || base.original_name || base.title || base.name || null,
      ano: anoDe(eSerie ? base.first_air_date : base.release_date),
      epNome: null,
      epData: null
    };
    if (comEpisodio) {
      const episodio = await buscaJson(`/tv/${id}/season/${s}/episode/${e}`, chave);
      if (episodio) {
        saida.epNome = episodio.name || episodio.episode_name || null;
        saida.epData = episodio.air_date || null;
      }
    }
    return saida;
  })().then((resultado) => {
    memo.set(memoChave, resultado);
    return resultado;
  }).catch((erro) => {
    memo.delete(memoChave);
    throw erro;
  });
  memo.set(memoChave, pendente);
  return pendente;
}
// `resolveImdb` e' exportado porque 4 das 7 fontes de VOD (SPT, VZR, RTD, DGO) e' as 3 de
// PAINEL (BLZ, SPC, ATO) NAO passam por `tituloDe`: elas chamam o TMDB do seu jeito, para o
// catalogo delas, e por isso precisam do mesmo `tt… -> id` na entrada. Sem esta exportacao
// elas teriam de repetir a chamada — e sao 7 copias do mesmo defeito esperando a proxima.
async function tmdbIdDe(valor, eSerie) {
  const canonico = idCanonico(valor);
  if (canonico.tmdb) return canonico.tmdb;
  if (!canonico.imdb) return null;
  return resolveImdb(canonico.imdb, !!eSerie, chaveApi());
}

module.exports = { tituloDe, tmdbIdDe };
