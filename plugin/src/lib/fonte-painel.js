const { novo } = require("../core/sandbox");
const { busca, chavesDe, nomeDe, SEM_INDEX } = require("./indice");
const { matchVodTitle, matchScore } = require("./match");
const { extractQuality, qualityScore } = require("./quality");
const { normalizeLoose, stripYear } = require("./text");
const { pegar, pegarJson } = require("./http");
const { UA } = require("./ua");
const painelApi = require("./painel");
const { apresenta } = require("./apresentacao");

// Orcamento da invocacao. O Nuvio da 60 s por scraper e roda 10 em paralelo
// (PLUGIN_TIMEOUT_MS / MAX_CONCURRENT_SCRAPERS), entao este teto e por fonte, nao
// global — as outras 14 fontes ja apareceram enquanto esta espera.
//
// MEDIDO 02/10/2026 deste servidor: `get_vod_info` do BLZ responde em 20,0 s
// (2 rodadas: 20,05 s e 19,94 s), o do SPC em 0,05 s e o do ATO nao responde
// direto (so pela reserva). Com o teto antigo de 15 s o BLZ gastava 12 s numa
// busca especulativa de catalogo, sobrava 2,9 s para o detalhe — e devolvia
// `[]` depois de 15 s. O dono autorizou pagar ~25 s para entregar link.
const TETO_MS = 30e3;
// O catalogo gzip e ESPECULATIVO: o shard do indice e estatico e responde em
// centenas de ms, entao nunca vale esperar o catalogo. O teto e curto de
// proposito — se o painel nao entrega o catalogo em 5 s, o shard assume e o
// catalogo e esquecido sem erro.
const MS_CATALOGO = 5e3;
const MS_SHARD = 6e3;
const MAX_TENTATIVAS = 3;
const MAX_RESULTADOS = 12;
// Os detalhes sao pedidos EM PARALELO. Medido: sao 20 s cada no BLZ, entao pedir
// os 3 candidatos em sequencia custaria 60 s (acima do teto do Nuvio) e ainda
// devolveria vazio. Em paralelo os 3 custam 20 s.
const CONC_DETALHE = 3;

function restante(p, ms) {
  return Math.max(1, Math.min(Number(ms) || 1, p.limite - Date.now()));
}

// MEDIDO: os tres paineis escrevem o catalogo em portugues ("Breaking Bad A Quimica do Mal",
// "Pânico 7", "Meteor City"), e o `matchVodTitle` do projeto e propositalmenteDURO — ele
// reprova continuacao e nome estendido. Casar so pelo titulo original en-US daria [] para a
// maioria do catalogo. Por isso o provider pede os DOIS titulos do TMDB (pt-BR e o
// original) e usa os dois como variantes de consulta, exatamente como o addon faz.
const CACHE_TITULO = new Map();

async function titulosDe(id, isTv, season, episode) {
  const memo = `${isTv ? "tv" : "movie"}:${id}:${isTv && season != null && episode != null ? `${season}:${episode}` : "-"}`;
  if (CACHE_TITULO.has(memo)) return CACHE_TITULO.get(memo);
  const pendente = (async () => {
    const chave = globalThis.TMDB_API_KEY;
    if (!chave || !String(chave).trim()) throw new Error("TMDB_API_KEY ausente");
    const tipo = isTv ? "tv" : "movie";
    const base = `https://api.themoviedb.org/3/${tipo}/${encodeURIComponent(id)}`;
    const q = `api_key=${encodeURIComponent(String(chave).trim())}`;
    const r = await Promise.all([
      pegarJson(`${base}?${q}&language=pt-BR`, { ms: 8e3 }),
      pegarJson(`${base}?${q}&language=en-US`, { ms: 8e3 })
    ]);
    const br = r[0].dados || {};
    const en = r[1].dados || {};
    if (!br.title && !br.name && !en.title && !en.name) {
      const st = r[0].status || r[1].status || "?";
      if (st === 404) return null;
      throw new Error(`TMDB ${tipo}/${id} respondeu ${st}`);
    }
    const anoDe = (d) => {
      const m = String(d || "").match(/^(\d{4})/);
      return m ? Number(m[1]) : null;
    };
    const saida = {
      titulos: [...new Set([br.title || br.name, en.title || en.name, br.original_title || br.original_name, en.original_title || en.original_name].filter(Boolean).map(String))],
      ano: anoDe(isTv ? br.first_air_date || en.first_air_date : br.release_date || en.release_date),
      epTmdb: {}
    };
    const s = Number(season);
    const e = Number(episode);
    const temEpisodio = season !== null && season !== void 0 && episode !== null && episode !== void 0 && Number.isFinite(s) && Number.isFinite(e);
    if (isTv && temEpisodio) {
      const chaveEp = `${s}:${e}`;
      const rEp = await pegarJson(`${base}/season/${s}/episode/${e}?${q}&language=pt-BR`, { ms: 8e3 });
      const dadosEp = rEp.dados || {};
      saida.epTmdb[chaveEp] = { id: Number(dadosEp.id) || null, nome: dadosEp.name || null, data: dadosEp.air_date || null };
    }
    return saida;
  })().then((resultado) => {
    CACHE_TITULO.set(memo, resultado);
    return resultado;
  }).catch((erro) => {
    CACHE_TITULO.delete(memo);
    throw erro;
  });
  CACHE_TITULO.set(memo, pendente);
  return pendente;
}

// MEDIDO 02/10/2026: isto servia BLZ, SPC e ATO e tinha o mesmo defeito das outras 4 fontes —
// `tt0133093` virava `0133093`, que o TMDB resolve como **"Strings" (2012)**. O log dizia o
// defeito inteiro: `[BLZ] 1584 item(s) lidos, nenhum casa com "Strings" — [] de proposito`.
// Este e' o `idDe` que o painel usa, entao a correcao e' aqui. Ver `src/lib/id-de-conteudo.js`.
const { idDe } = require("./id-de-conteudo");
const { tmdbIdDe } = require("./tmdb");

function idiomaDe(nome) {
  const n = normalizeLoose(nome);
  if (/\bl\b(\s|$)|\[[^\]]*\bl\b[^\]]*\]|legendado/.test(n)) return "Legendado";
  if (/dublado/.test(n)) return "Dublado";
  return null;
}

function montaLinha(qualidade, idioma, sigla) {
  return [qualidade, idioma, sigla].filter(Boolean).join(" · ");
}

// O nome do painel costuma ser o titulo de origem acrescido do subtitulo local, e o
// separador varia: o BLZ escreve "Breaking Bad: A Quimica do Mal" (com dois-pontos, e o
// `matchVodTitle` aceita), o SPC escreve "Breaking Bad A Quimica do Mal" (sem, e reprova).
// MEDIDO nos 3 catalogos: e a unica diferenca entre "casa" e "nao casa" em serie. Por isso
// o provider usa uma regra de serie explicita e COMPROVA com o `tmdb_id` do episodio, que a
// origem traz em `get_series_info` — prova mais forte que o nome, e que o addon tambem usa.
const SERIE_MINIMA = 70;

function canonicoBasico(s) {
  return normalizeLoose(s).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function nomeTemSobretitulo(nome, consulta, ano) {
  const c = canonicoBasico(stripYear(nome));
  const q = canonicoBasico(stripYear(consulta));
  if (!c || !q || c === q) return false;
  if (!c.startsWith(q)) return false;
  const resto = c.slice(q.length).trim();
  if (!resto) return false;
  if (/^(?:19|20)\d{2}$/.test(resto)) return false;
  if (/\d/.test(resto)) return false;
  return resto.split(" ").filter(Boolean).length >= 1;
}

function pontua(item, titulos, isTv, ano) {
  const nome = nomeDe(item);
  if (!nome) return -1;
  let melhor = -1;
  let casa = false;
  for (const t of titulos) {
    if (matchVodTitle(nome, t, isTv, ano)) casa = true;
    const s = matchScore(t, nome);
    if (s > melhor) melhor = s;
  }
  if (!casa) {
    if (!isTv || melhor < SERIE_MINIMA) return -1;
    if (!titulos.some((t) => nomeTemSobretitulo(nome, t, ano))) return -1;
  }
  let pontos = melhor;
  if (item.y && ano && Number(item.y) === Number(ano)) pontos += 20;
  if (item.y && ano && Number(item.y) !== Number(ano)) pontos -= 40;
  pontos += (qualityScore(extractQuality(item.t)) || 0) * 2;
  return pontos;
}

function tmdbDoEpisodio(info, temporada, episodio) {
  const ep = painelApi.episodiosDe(info, temporada, episodio);
  if (!ep) return null;
  const bloco = ep.info && typeof ep.info === "object" ? ep.info : {};
  const n = Number(bloco.tmdb_id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function aceitaTmdb(info, id, titulos, isTv, ano) {
  const tmdb = painelApi.tmdbDe(info);
  if (tmdb && tmdb !== Number(id)) return false;
  const nome = painelApi.nomeDe(info);
  if (nome && titulos.some((t) => matchVodTitle(nome, t, isTv, ano))) return true;
  return tmdb === Number(id);
}

function anoDe(bruto, nome) {
  const n = Number(bruto);
  if (Number.isFinite(n) && n >= 1890 && n <= 2200) return n;
  const s = String(nome || "");
  const paren = s.match(/\(((?:19|20)\d{2})\)/);
  if (paren) return Number(paren[1]);
  const fim = s.match(/(?:^|\s)((?:19|20)\d{2})\s*$/);
  return fim ? Number(fim[1]) : 0;
}

function itemDeCatalogo(x) {
  const nome = String((x && (x.name || x.title)) || "").trim();
  const id = Number(x && x.stream_id);
  if (!nome || !Number.isFinite(id)) return null;
  return {
    i: id,
    n: normalizeLoose(nome),
    t: nome,
    s: 0,
    y: anoDe(x.year || x.release_date || x.releaseDate, nome),
    e: String(x.container_extension || "").toLowerCase().replace(/[^a-z0-9]/g, "")
  };
}

function paginaDeErro(texto) {
  const t = String(texto || "").slice(0, 400).toLowerCase();
  return /<!doctype html|<html|welcome to nginx|error|forbidden|too many requests/.test(t);
}

async function catalogoGzip(painel, ms) {
  const url = painelApi.urlApi(painel, { action: "get_vod_streams" });
  let r = null;
  try {
    r = await pegar(url, {
      ms: Math.min(Number(ms) || MS_CATALOGO, MS_CATALOGO),
      headers: { Accept: "application/json", "Accept-Encoding": "gzip", "User-Agent": UA }
    });
  } catch (e) {
    return { itens: null, motivo: `rede: ${e && e.message ? e.message : e}` };
  }
  if (!r.ok) return { itens: null, motivo: `HTTP ${r.status}` };
  // O painel ATO responde `200` com a pagina padrao do nginx (235 B) para IP de datacenter
  // (MEDIDO). Checar isso ANTES de tentar parsear evita 3 rodadas de parse-exception.
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  if (tipo.includes("text/html")) return { itens: null, motivo: `a origem devolveu ${tipo} (IP de datacenter recusado)` };
  let texto = "";
  try {
    texto = await r.text();
  } catch (e) {
    return { itens: null, motivo: `corpo cortado pelo runtime: ${e && e.message ? e.message : e}` };
  }
  if (paginaDeErro(texto)) return { itens: null, motivo: `a origem devolveu pagina de erro (${texto.length} B)` };
  let dados = null;
  try {
    dados = JSON.parse(texto);
  } catch (e) {
    return { itens: null, motivo: `JSON invalido — ${texto.length} bytes recebidos de um catalogo de ~4,77 MB: o runtime cortou` };
  }
  if (!Array.isArray(dados)) return { itens: null, motivo: "resposta JSON que nao e lista" };
  const itens = dados.map(itemDeCatalogo).filter(Boolean);
  if (!itens.length) return { itens: null, motivo: "catalogo sem itens" };
  return { itens, motivo: "", bytes: texto.length };
}

// O shard do indice e o catalogo gzip do painel sao DOIS caminhos para os mesmos
// itens, entao nao ha motivo para esperar um depois do outro. MEDIDO 02/10/2026: o
// shard e um arquivo estatico e responde em centenas de ms; o catalogo gzip do
// BLZ nao respondeu em 12 s (2 rodadas) e o do ATO nunca responde deste IP.
//
// MEDIDO o custo da versao antiga, que fazia `await catalogo` e DEPOIS
// `await shard`: o BLZ gastava 12 s do orcamento de 15 s num catalogo que ele
// nem usa, sobrava 2,9 s para o `get_vod_info` (que leva 20 s) e a fonte
// devolvia `[]` depois de 15 s — 15 s perdidos e zero entrega.
//
// Aqui o primeiro que ENTREGAR ITEM vence e o perdedor e solto sem `await` e sem
// erro. Se nenhum entregar na primeira volta, espera-se o outro antes de desistir.
async function primeiroQueEntrega(painel, st, o, ns) {
  const comItens = (r) => !!(r && r.itens && r.itens.length);
  const rotuloShard = (r) => `shard do indice (${r.itens.length} itens de /idx/${ns}/)`;
  const rotuloCatalogo = (r) => `catalogo gzip do painel (${r.itens.length} itens, ${r.bytes} B)`;
  const ganhou = async (r, rotulo) => {
    if (!comItens(r)) return null;
    if (!o.calado) console.log(`[${painel.sigla}] caminho: ${rotulo(r)}`);
    return r.itens;
  };
  const shard = Promise.resolve(st.shard).then((r) => ganhou(r, rotuloShard), () => null);
  if (!st.catalogo) {
    const itens = await shard;
    if (!itens) console.log(`[${painel.sigla}] sem indice e sem catalogo — ${SEM_INDEX}`);
    return itens || [];
  }
  const catalogo = Promise.resolve(st.catalogo).then((r) => ganhou(r, rotuloCatalogo), () => null);
  const primeiro = await Promise.race([shard, catalogo]);
  if (primeiro) return primeiro;
  const perdedor = (await Promise.all([shard, catalogo])).find(Boolean);
  if (!perdedor) console.log(`[${painel.sigla}] sem indice e sem catalogo — ${SEM_INDEX}`);
  return perdedor || [];
}

function criaFonte(painel, opcoes) {
  const o = opcoes || {};
  return async function getStreams(tmdbId, mediaType, season, episode, estado) {
    const isTv = String(mediaType || "").toLowerCase() === "tv";
    // MEDIDO 02/10/2026: o caminho do dono e' o id do **Cinemeta** (`tt0133093`), porque o
    // MirrorStream nao tem catalogo — ele e' chamado quando o usuario abre um vod. O `idDe`
    // abaixo so' aceita TMDB, entao o IMDb e' resolvido AQUI, antes de qualquer consulta ao
    // painel. Antes desta linha, `tt0133093` virava `0133093` e o painel era consultado pelo
    // filme errado: o log dizia `[BLZ] nenhum casa com "Strings" — [] de proposito`.
    const id = await tmdbIdDe(tmdbId, isTv);
    if (!id) return [];
    const p = novo(TETO_MS);
    let meta = null;
    try {
      meta = await titulosDe(id, isTv, season, episode);
    } catch (e) {
      throw new Error(`${painel.sigla}: TMDB ${id} nao respondeu (${e && e.message ? e.message : e})`);
    }
    if (!meta || !meta.titulos.length) return [];
    const titulos = meta.titulos;
    const ns = painel.idx || String(painel.sigla || "").toLowerCase();

    let itens = null;
    if (o.catalogo === false) {
      const achado = await busca(chavesDe(titulos), { ns, ms: MS_SHARD });
      itens = achado.itens;
      if (!itens.length) console.log(`[${painel.sigla}] nenhum item em /idx/${ns}/ para "${titulos[0]}" (letras ${(achado.letras || []).join(",")}) — ${SEM_INDEX}`);
    } else {
      const st = estado || {};
      if (!st.shard) {
        st.shard = busca(chavesDe(titulos), { ns, ms: MS_SHARD });
        st.shard.catch(() => {});
      }
      itens = await primeiroQueEntrega(painel, st, o, ns);
    }
    if (!itens || !itens.length) return [];

    const ano = isTv ? null : meta.ano;
    const doTipo = itens.filter((i) => (isTv ? i.s === 1 : i.s === 0));
    const ranked = doTipo
      .map((item) => ({ item, pontos: pontua(item, titulos, isTv, ano) }))
      .filter((r) => r.pontos >= 0)
      .sort((a, b) => b.pontos - a.pontos);
    if (!ranked.length) {
      console.log(`[${painel.sigla}] ${itens.length} item(s) lidos, nenhum casa com "${titulos[0]}" — [] de proposito`);
      return [];
    }

    const vistos = new Set();
    const candidatos = ranked.slice(0, MAX_TENTATIVAS);
    if (!candidatos.length) return [];
    if (p.passou() || p.sobra() < 1500) {
      console.log(`[${painel.sigla}] orcamento de ${TETO_MS / 1000}s estourado antes do detalhe (${ranked.length} candidato(s))`);
      return [];
    }

    const detalhes = await Promise.all(
      candidatos.map(({ item }) =>
        painelApi
          .detalheDe(painel, item.i, isTv, restante(p, o.painelMs || TETO_MS))
          .then((info) => ({ item, info, erro: null }))
          .catch((e) => ({ item, info: null, erro: e }))
      )
    );

    const streams = [];
    for (const { item, info, erro } of detalhes) {
      if (streams.length >= MAX_RESULTADOS) break;
      if (erro) {
        console.log(`[${painel.sigla}] ${isTv ? "get_series_info" : "get_vod_info"}(${item.i}) falhou: ${erro && erro.message ? erro.message : erro}`);
        continue;
      }
      const qualidade = extractQuality(item.t);
      const comum = {
        sigla: painel.sigla,
        qualidade,
        idioma: idiomaDe(item.t),
        titulo: titulos[0],
        ano
      };
      let url = null;
      if (isTv) {
        if (!info || !info.episodes) continue;
        const s = Number(season) || 1;
        const ep = painelApi.episodiosDe(info, s, Number(episode) || 1);
        if (!ep) continue;
        // Prova do episodio. MEDIDO nos 3 paineis: o `tmdb_id` do episodio pode ser o id do
        // EPISODIO (blz/ato, ex. 62085) ou o da SERIE (spc, ex. 1396). Os dois batem com o
        // pedido do TMDB; qualquer outro valor reprova o candidato. E o portao mais forte
        // que existe aqui — o `matchVodTitle` sozinho reprova o SPC, que escreve o
        // subtitulo sem separador ("Breaking Bad A Quimica do Mal").
        const esperado = (meta.epTmdb || {})[`${s}:${Number(episode) || 1}`];
        if (esperado && esperado.id) {
          const veio = tmdbDoEpisodio(info, s, Number(episode) || 1);
          if (veio && veio !== esperado.id && veio !== Number(id)) continue;
        }
        url = painelApi.urlDoEpisodio(painel, ep.id, ep.container_extension);
        comum.temporada = s;
        comum.episodio = Number(episode) || 1;
      } else {
        if (info && !aceitaTmdb(info, id, titulos, isTv, ano)) continue;
        url = painelApi.urlDoFilme(painel, item.i, item.e || (info && info.info && info.info.container_extension));
      }
      if (!url || vistos.has(url)) continue;
      vistos.add(url);
      streams.push(apresenta({ ...comum, url }));
    }
    if (!streams.length) {
      console.log(`[${painel.sigla}] casou o titulo mas nao devolve link (${ranked.length} candidato(s), ${candidatos.length} detalhe(s) pedido(s)) — [] de proposito, nunca inventar stream`);
    }
    return streams;
  };
}

module.exports = { criaFonte, catalogoGzip, idiomaDe, montaLinha, pontua, anoDe, itemDeCatalogo, titulosDe, TETO_MS };
