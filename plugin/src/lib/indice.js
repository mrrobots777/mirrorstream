const { pegar } = require("./http");

const RAIZ_INDICE = "/idx";
const CACHE_SHARD = new Map();

const ARTIGULOS = new Set([
  "o", "a", "os", "as", "um", "uma", "uns", "umas",
  "the", "an", "el", "la", "los", "las", "le", "les",
  "der", "die", "das", "den", "do", "da", "dos", "e", "y"
]);

// MEDIDO 02/10/2026: o repositorio foi renomeado de `mirror` para `mirrorstream`, entao a
// URL do Pages mudou. A URL antiga (`github.io/mirror/`) responde **404** — quem tinha o
// plugin instalado precisa instalar de novo pelo endereco novo.
// O `test/pastas.test.js` trava que este valor bate com o nome do repositorio: um
// repositorio renomeado sem este valor corrigido nao quebra build nenhum, so quebra o
// aparelho de quem ja tinha o plugin.
const BASE_PADRAO = "https://mrrobots777.github.io/mirrorstream";

const SEM_INDEX = [
  "indice estatico indisponivel (404/erro ao ler o shard).",
  "o plugin so descobre o id do stream pelo indice: publica plugin/public/ no GitHub Pages",
  "(a raiz `public/` vai junto com o manifest.json) e aponta este endereco:",
  BASE_PADRAO,
  "para gerar: node tools/gerar-indice.js | para publicar: .github/workflows/publicar-pages.yml",
  "enquanto isso a fonte devolve [] de proposito — nunca inventar stream."
].join(" ");

function base() {
  const de = globalThis.MIRROR_INDEX_BASE;
  const cru = de === null || de === void 0 ? BASE_PADRAO : String(de);
  return String(cru || "").replace(/\/+$/, "");
}

function semAcento(str) {
  return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function primeiraPalavra(titulo, tiraArtigo) {
  const limpo = semAcento(titulo).replace(/\([^)]*\)/g, " ").replace(/[[\]|/]/g, " ");
  const todas = limpo.split(/[^a-z0-9]+/).filter(Boolean);
  if (!todas.length) return "";
  if (!tiraArtigo) return todas[0];
  const sem = todas.filter((p) => !ARTIGULOS.has(p));
  return sem[0] || todas[todas.length - 1];
}

function letraDe(palavra) {
  const c = String(palavra || "").charAt(0);
  if (/[a-z]/.test(c)) return c;
  if (/[0-9]/.test(c)) return "0";
  return "#";
}

function chaveDe(titulo) {
  return letraDe(primeiraPalavra(titulo, true));
}

function chavesDe(titulos) {
  const lista = Array.isArray(titulos) ? titulos : [titulos];
  const saida = [];
  for (const t of lista) {
    if (!String(t || "").trim()) continue;
    for (const k of [chaveDe(t), letraDe(primeiraPalavra(t, false))]) {
      if (k && !saida.includes(k)) saida.push(k);
    }
  }
  return saida;
}

function linhaDe(item) {
  if (Array.isArray(item)) return { i: item[0], n: item[1], t: item[2], s: item[3] ? 1 : 0, y: Number(item[4]) || 0, e: item[5] || "" };
  if (item && typeof item === "object") return { i: item.i, n: item.n, t: item.t, s: item.s ? 1 : 0, y: Number(item.y) || 0, e: item.e || "" };
  return null;
}

function itensDoShard(dados) {
  if (!dados || typeof dados !== "object") return [];
  const lista = Array.isArray(dados.it) ? dados.it : [];
  const saida = [];
  for (const bruto of lista) {
    const item = linhaDe(bruto);
    if (item && item.i !== undefined && item.i !== null && item.n) saida.push(item);
  }
  return saida;
}

async function pegaShard(ns, chave, ms) {
  const url = `${base()}${RAIZ_INDICE}/${encodeURIComponent(ns)}/${encodeURIComponent(chave)}.json`;
  let r = null;
  try {
    r = await pegar(url, { ms: Math.max(2000, Number(ms) || 6000) });
  } catch (e) {
    console.log(`[indice] shard ${ns}/${chave} nao leu (${e && e.message ? e.message : e}) — ${SEM_INDEX}`);
    return { chave, itens: [], erro: true };
  }
  if (r.status === 404 || r.status === 403) {
    console.log(`[indice] ${url} respondeu ${r.status} — ${SEM_INDEX}`);
    return { chave, itens: [], erro: true };
  }
  if (!r.ok) {
    console.log(`[indice] shard ${ns}/${chave} respondeu HTTP ${r.status} — ${SEM_INDEX}`);
    return { chave, itens: [], erro: true };
  }
  let dados = null;
  try {
    dados = JSON.parse(await r.text());
  } catch (e) {
    console.log(`[indice] shard ${ns}/${chave} nao e JSON valido (pode ter sido cortado no teto de 1 MB) — ${SEM_INDEX}`);
    return { chave, itens: [], erro: true };
  }
  return { chave, itens: itensDoShard(dados), erro: false, dividido: !!dados.d, partes: dados.p || [], tamanho: Number(dados.n) || 0 };
}

async function carrega(ns, chave, ms) {
  const cacheKey = `${ns}:${chave}`;
  if (CACHE_SHARD.has(cacheKey)) return CACHE_SHARD.get(cacheKey);
  const pendente = (async () => {
  const primeira = await pegaShard(ns, chave, ms);
  if (!primeira.erro && primeira.dividido) {
    const partes = primeira.partes.length ? primeira.partes : [chave];
    const todas = [];
    for (const p of partes) {
      const sub = await pegaShard(ns, p, ms);
      if (!sub.erro) todas.push(...sub.itens);
    }
    return { chave, itens: todas, bytes: 0 };
  }
  return { chave, itens: primeira.itens, bytes: primeira.tamanho };
  })().catch((erro) => {
    CACHE_SHARD.delete(cacheKey);
    throw erro;
  });
  CACHE_SHARD.set(cacheKey, pendente);
  return pendente;
}

function nomeDe(item) {
  if (!item) return "";
  const ano = Number(item.y) || 0;
  const base = String(item.n || "");
  return ano ? `${base} (${ano})` : base;
}

async function busca(chaves, opcoes) {
  const o = opcoes || {};
  const ms = Number(o.ms) || 6000;
  const ns = String(o.ns || "");
  const vistos = new Set();
  const encontrados = [];
  const letras = [];
  const unicas = chaves.filter((chave) => {
    if (!chave || vistos.has(chave)) return false;
    vistos.add(chave);
    letras.push(chave);
    return true;
  });
  const resultados = await Promise.all(unicas.map((chave) => carrega(ns, chave, ms).catch(() => ({ chave, itens: [], erro: true }))));
  for (const r of resultados) {
    if (r.erro) continue;
    for (const item of r.itens) {
      const marca = `${r.chave}:${item.i}:${item.s}`;
      if (vistos.has(marca)) continue;
      vistos.add(marca);
      encontrados.push(item);
    }
    if (o.paraNaPrimeira && encontrados.length) break;
  }
  return { itens: encontrados, letras };
}

module.exports = {
  ARTIGULOS,
  BASE_PADRAO,
  RAIZ_INDICE,
  SEM_INDEX,
  base,
  chaveDe,
  chavesDe,
  busca,
  carrega,
  itensDoShard,
  nomeDe,
  primeiraPalavra
};
