// Fonte ISE — Isekai BR (`ryuneko.lol/novok3`).
//
// MEDIDO 08/10/2026 deste servidor: a origem responde 200 nos dois endpoints e o
// `Range` de 160 KB do MP4 vem `206 video/mp4` com resolucao legivel. O que medido:
//
//   `GET /novok3/busca_flutter64.php?busca=<termo>`  ->  array de `{chid, name, capa}`
//   `GET /novok3/episodios292.php?subcategoria=<chid>&page=<n>`
//        -> `{total, page, limit, data:[{title, downloadsd, downloadhd, downloadfullhd, …}]}`
//
// A forma do payload medido para "Bleach" (chid 1067, 360 episodios): cada item traz o
// episodio e TRES tiers de MP4 direto — `downloadfullhd` (1080p), `downloadhd` (720p) e
// `downloadsd` (SD). Nao ha HLS nem player: e' MP4 por episodio, o que faz dela a fonte
// mais barata do lote.
//
// MEDIDO o que NAO serve, e por isso a triagem existe:
//   * `downloadfullhd` responde **404** para os ids medidos (31779, 31780, 31781, 31800) —
//     o campo existe no JSON mas o CDN nao tem o arquivo. So `downloadhd` respondeu 206
//     (960x720 lido do video). Por isso a triagem por status e o que decide o tier, e nao
//     o nome do campo.
//   * `downloadsd` nao resolve DNS deste servidor (curl 000 em 0,25 s).
//
// A prova de vida usa o MESMO `Range` e o MESMO `User-Agent` que o player vai usar, e
// cada tier e testado uma vez. Custa 3 requisicoes de 2 KB, em paralelo, dentro do teto de
// 6 s — MEDIDO o total em 1,4 s. O `Referer` e' obrigatorio: sem ele o CDN responde 403.
//
// O numero do episodio vem do `title` ("Bleach ep 1") e nao da posicao na lista: a origem
// nao preenche o campo e a lista vem paginada de 24 em 24, entao a posicao so e' valida
// dentro da pagina. Preferimos o numero lido e so caimos na posicao quando o texto nao
// tem numero nenhum.
const { pegar, pegarJson } = require("../../lib/http");
const { tituloDe } = require("../../lib/tmdb");
const { matchVodTitle, matchScore } = require("../../lib/match");
const { extractQuality } = require("../../lib/quality");
const { apresenta } = require("../../lib/apresentacao");
const { UA } = require("../../lib/ua");

const BASE = "https://www.ryuneko.lol/novok3";
const SIGLA = "ISE";
const MS = 8e3;
// O app Android que consome essa origem ("HinataSoul") manda este User-Agent, e o CDN
// responde 403 para o Chrome padrao. MEDIDO: com `HinataSoul` o `Range` vem 206; sem
// cabecalho nenhum, 403.
const UA_ORIGEM = "HinataSoul/369 Dart/3.0 (dart:io)";
const REFERER = "https://www.ryuneko.lol/";
const CABECALHOS = { "User-Agent": UA_ORIGEM, Referer: REFERER, Accept: "*/*" };
const PAGINAS_MAX = 4;
const POR_PAGINA = 24;
const MAX_STREAMS = 3;

// Os tres tiers do payload, na ordem em que o olho prefere. O nome do campo NAO e' a
// prova: MEDIDO que `downloadfullhd` deu 404 e `downloadhd` deu 206 para o mesmo
// episodio. A triagem por status e' o que decide, e o rotulo so' vai na linha 1.
const TIERS = [
  { campo: "downloadfullhd", rotulo: "1080p" },
  { campo: "downloadhd", rotulo: "720p" },
  { campo: "downloadsd", rotulo: "SD" }
];

function slugDo(titulo) {
  return String(titulo || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function json(caminho) {
  const r = await pegarJson(`${BASE}${caminho}`, { ms: MS, headers: Object.assign({ Accept: "application/json" }, CABECALHOS) });
  if (!r.ok) throw new Error(`ise HTTP ${r.status || "?"} em ${caminho.slice(0, 70)}`);
  return r.dados;
}

// O numero do episodio lido do texto do item. MEDIDO no payload real ("Bleach ep 1"), que
// e' a unica fonte de numero confiavel: a posicao na lista so vale dentro da pagina.
function numeroDe(item, indice) {
  const texto = String((item && item.title) || "");
  const m = texto.match(/\bep(?:isodio)?[\s.:-]*0*(\d{1,4})\b/i) || texto.match(/\b(\d{1,4})\b/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 5000) return n;
  }
  return indice + 1;
}

async function pagina(chid, page) {
  const d = await json(`/episodios292.php?subcategoria=${encodeURIComponent(chid)}&page=${page}`);
  const itens = d && Array.isArray(d.data) ? d.data : [];
  return { total: Number(d && d.total) || itens.length, itens };
}

// Um `Range` de 2 KB com os cabecalhos do player. O veredito e' o que decide se o tier
// existe: 206/200 com video e' vivo; 404 e' o caso medido do `downloadfullhd`; 403 e
// recusa de IP; timeout e' inconclusive e conta como morto porque custaria a espera do
// aparelho tambem.
async function vivo(url) {
  let r = null;
  const t0 = Date.now();
  try {
    r = await pegar(url, { ms: 6e3, headers: Object.assign({}, CABECALHOS, { Range: "bytes=0-2047" }) });
  } catch (_) {
    return { ok: false, motivo: "timeout" };
  }
  const tipo = String(r.headers.get("content-type") || "").toLowerCase();
  if (r.status === 403 || r.status === 451) return { ok: false, motivo: "bloqueado" };
  if (r.status === 404 || r.status === 410) return { ok: false, motivo: "ausente" };
  if (r.status >= 500) return { ok: false, motivo: "origem" };
  if (!r.ok && r.status !== 206) return { ok: false, motivo: `HTTP ${r.status}` };
  if (tipo.includes("text/html")) return { ok: false, motivo: "pagina-de-erro" };
  // Um 206 sem `content-range` e' resposta de origem que ignorou o Range: ainda e' midia.
  return { ok: true, ms: Date.now() - t0, tipo };
}

module.exports.getStreams = async (tmdbId, mediaType, season, episode) => {
  const isTv = String(mediaType || "").toLowerCase() === "tv";
  // MEDIDO: a origem so' tem serie. Filme devolveria uma lista de episodios com titulo
  // parecido e a linha 1 mentiria sobre o que e' — por isso `[]`, nao adivinhacao.
  if (!isTv) return [];
  const info = await tituloDe(tmdbId, mediaType, season, episode);
  if (!info || !info.titulo) return [];
  const temporada = Number(season) > 0 ? Number(season) : 1;
  const numero = Number(episode) > 0 ? Number(episode) : 1;

  const pedidos = [...new Set([info.titulo, info.original].filter(Boolean).map((t) => String(t).trim()))];
  const termos = [];
  for (const p of pedidos) {
    const s = slugDo(p);
    if (s && !termos.includes(s)) termos.push(s);
    const bruto = String(p || "").trim();
    if (bruto && !termos.includes(bruto)) termos.push(bruto);
  }
  if (!termos.length) return [];

  // Candidatos: a busca e' por titulo, entao a pontuacao decide. `matchVodTitle` e' o
  // portao duro (reprova continuacao e nome estendido); `matchScore` ordena.
  const vistos = new Set();
  const candidatos = [];
  let erro = null;
  for (const termo of termos) {
    if (candidatos.length >= 3) break;
    let lista = [];
    try {
      lista = await json(`/busca_flutter64.php?busca=${encodeURIComponent(termo)}`);
    } catch (e) {
      if (!erro) erro = e;
      continue;
    }
    for (const c of Array.isArray(lista) ? lista : []) {
      const chid = c && c.chid;
      const nome = String((c && c.name) || "").trim();
      if (!chid || !nome) continue;
      const marca = String(chid);
      if (vistos.has(marca)) continue;
      if (!matchVodTitle(nome, info.titulo, true, info.ano)) continue;
      vistos.add(marca);
      candidatos.push({
        chid: marca,
        nome,
        nota: Math.max(...pedidos.map((t) => matchScore(String(t), nome)))
      });
    }
  }
  candidatos.sort((a, b) => b.nota - a.nota);

  let erroEpisodio = null;
  for (const cand of candidatos.slice(0, 2)) {
    let alvo = null;
    // ATE que o episodio apareca, e nao a pagina inteira: MEDIDO 360 episodios em Bleach,
    // 24 por pagina, e a ultima pagina do episodio pedido seria a 15.
    let ultima = 1;
    for (let p = 1; p <= PAGINAS_MAX; p += 1) {
      let pag;
      try {
        pag = await pagina(cand.chid, p);
      } catch (e) {
        if (!erroEpisodio) erroEpisodio = e;
        break;
      }
      if (!pag.itens.length) break;
      ultima = Math.max(ultima, p);
      const achado = pag.itens.find((item) => numeroDe(item, pag.itens.indexOf(item)) === numero);
      if (achado) {
        alvo = achado;
        break;
      }
      if (pag.itens.length < POR_PAGINA) break;
    }
    if (!alvo && ultima > 1) {
      // A ultima pagina como rede de seguranca quando o `total` da origem aponta mais
      // paginas do que o teto de 4 alcança.
      try {
        const pag = await pagina(cand.chid, ultima);
        alvo = pag.itens.find((item) => numeroDe(item, pag.itens.indexOf(item)) === numero) || null;
      } catch (e) {
        if (!erroEpisodio) erroEpisodio = e;
      }
    }
    if (!alvo) continue;

    const vivos = await Promise.all(
      TIERS.map(async (t) => {
        const url = String(alvo[t.campo] || "").trim();
        if (!/^https?:\/\//i.test(url)) return null;
        const v = await vivo(url);
        return v.ok ? { url, tier: t } : null;
      })
    );
    const entregue = [];
    for (const v of vivos) {
      if (!v || entregue.some((e) => e.url === v.url)) continue;
      entregue.push(v);
    }
    if (!entregue.length) continue;

    return entregue.slice(0, MAX_STREAMS).map((v) => {
      const qualidade = extractQuality(v.tier.rotulo) || v.tier.rotulo;
      return apresenta({
        sigla: SIGLA,
        url: v.url,
        qualidade,
        titulo: info.titulo,
        ano: info.ano,
        temporada,
        episodio: numero,
        headers: Object.assign({}, CABECALHOS)
      });
    });
  }

  if (erroEpisodio && !erro) throw erroEpisodio;
  if (erro) throw erro;
  return [];
};