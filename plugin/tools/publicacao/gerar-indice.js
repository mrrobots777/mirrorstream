const fs = require("fs");
const path = require("path");

const { chaveDe, primeiraPalavra } = require("../../src/lib/indice");
const fontes = require("../../src/core/fontes");
const { TETO_CORPO_BYTES } = require("../../src/core/sandbox");
const { painelDoPlugin: painelDoPluginDe } = require("./painel-do-plugin");

const { RAIZ, RAIZ_REPO } = require("../_caminhos");
const ALVO_PADRAO = 400 * 1024;
// `fontesDePainel`, e nao `fontesComIndice`: o gerador so sabe chamar `player_api.php`, que
// existe em painel Xtream. Uma fonte com prefixo de shard e' API propria (o RTD) nao tem
// credencial de painel — ver `fontesDePainel` em `src/core/fontes/index.js`.
const FONTES = fontes.fontesDePainel();
const UA = "Mozilla/5.0 (Windows NT.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const AGORA = Math.floor(Date.now() / 1000);

const args = process.argv.slice(2);
const DIRETO = args.includes("--direto");

const ADDON = RAIZ;
const SAIDA = process.env.IDICE_SAIDA || path.join(RAIZ, "public", "idx");
const SO = (args.find((a) => !a.startsWith("--")) || "").trim().toLowerCase();
const ALVO = (() => {
  const a = args.find((x) => x.startsWith("--alvo="));
  const n = a ? Number(a.split("=")[1]) : Number(process.env.IDICE_ALVO_BYTES) || ALVO_PADRAO;
  return Math.max(4 * 1024, Math.floor(n) || ALVO_PADRAO);
})();
const SEM_ESCREVER = process.env.IDICE_SALVA === "1";
const USA_CACHE = process.env.IDICE_CACHE === "1";
const CACHE_DIR = process.env.IDICE_CACHE_DIR || path.join(require("os").tmpdir(), "nuvio-idx");

// A lista de workers NAO e' escrita aqui. `infra/workers/lista-workers.json` e' a fonte
// unica, e a mesma que o `infra/workers/deploy-workers.sh` publica: um worker usado pelo
// indice e nunca publicado (ou o contrario) e' link quebrado em producao, e com o mapa em
// dois lugares os dois desandavam sem ninguem perceber.
const WORKERS = require(path.join(RAIZ_REPO, "infra", "workers", "lista-workers.json"));
const WORKER_SUFFIX = "mr-caiomendonca.workers.dev";
function workerDe(fonte) {
  const nome = WORKERS[fonte];
  return nome ? `https://${nome}.${WORKER_SUFFIX}` : "";
}

function campoEnv(bloco, nome, variavel) {
  const re = new RegExp(`${nome}\\s*:\\s*ENV\\.${variavel}\\s*\\|\\|\\s*"([^"]*)"`);
  const m = bloco.match(re);
  return process.env[variavel] || (m ? m[1] : "");
}

function paineisDoAddon() {
  // O indice e' gerado a partir das credenciais dos proprios scrapers do plugin. Os workers
  // por fonte servem para buscar os catalogos com seguranca, e sao tentados ANTES do painel
  // direto (ver `rotasDe`).
  //
  // MEDIDO 08/10/2026: `fontesComIndice()` devolve o RTD junto com BLZ/SPC/ATO, mas o RTD
  // NAO e' um painel Xtream — o scraper dele fala com `/api/catalog-index` e nao tem
  // `servidor`/`usuario`/`senha`. O `painelDoPlugin` devolvia um objeto com campos vazios, a
  // URL virava `https://:/player_api.php?...` e a fonte era marcada como "sem shard" com um
  // erro de parse que nao dizia nada sobre o RTD. O filtro fica aqui: uma fonte so entra no
  // gerador de shards se tem credencial de painel.
  const paineis = {};
  for (const fonte of FONTES) {
    const painel = painelDoPlugin(fonte);
    if (!painel || !painel.servidor || !painel.usuario || !painel.senha) {
      console.log(`[indice] ${fonte} fora: nao e' painel Xtream (sem servidor/usuario/senha) — o catalogo dele vem da propria API da fonte`);
      continue;
    }
    paineis[fonte] = painel;
  }
  return paineis;
}
function painelDoPlugin(chave) {
  // A credencial vem do AMBIENTE, nao do texto do scraper — ver o modulo
  // `painel-do-plugin.js` e o teste em `plugin/test/painel-do-plugin.test.js`.
  // MEDIDO 10/10/2026: quando a credencial saiu do codigo, este gerador
  // continuou lendo o texto, nao achou nada, e o `publicar-pages` quebrou com
  // `nenhuma fonte gerou shard` — deixando no ar o bundle ANTIGO, que e' o que
  // ainda tinha a credencial dentro. O CI pega as variaveis de `secrets`.
  return painelDoPluginDe(RAIZ, fontes.caminhoDe, chave);
}

function comparaCredencial(chave, doAddon, doPlugin) {
  const linhas = [];
  if (doPlugin.idx !== chave) linhas.push(`  ${chave}.idx: esperado "${chave}", plugin diz "${doPlugin.idx}" (e o namespace do shard)`);
  if (doPlugin.sigla !== chave.toUpperCase()) linhas.push(`  ${chave}.sigla: esperado "${chave.toUpperCase()}", plugin diz "${doPlugin.sigla}"`);
  for (const campo of ["servidor", "porta", "usuario", "senha"]) {
    const a = String(doAddon[campo] || "");
    const b = String(doPlugin[campo] || "");
    if (a !== b) linhas.push(`  ${chave}.${campo}: addon="${a}" plugin="${b}"`);
  }
  return linhas;
}

function baseDe(painel) {
  const proto = String(painel.porta) === "80" ? "http" : "https";
  return `${proto}://${painel.servidor}:${painel.porta}`;
}

// MEDIDO 08/10/2026: o `mirror-ato` respondia `403 host not allowed` para `firetvcb.net`
// e o gerador inteiro MORRIA com `erro: HTTP 403` — o deploy do Pages caia, levava junto
// os shards de BLZ e SPC que ja tinham sido gerados, e o ATO perdia o indice mesmo
// respondendo 200 direto. Duas coisas estavam erradas, e as duas sao daqui:
//
// 1. `firetvcb.net` ESTA na allowlist do `mirror-cdn.js` (MEDIDO 07/10), mas o worker
//    publicado e' anterior a essa entrada: allowlist e' parte do codigo do worker, entao
//    host novo so entra em producao no proximo deploy. O gerador dependia de um deploy que
//    nao e' dele para poder rodar.
//
// 2. A ordem. O painel responde 200 direto e o worker responde 403 — entao a rota boa era a
//    ultima a ser tentada. Isto e' a MESMA politica de `src/lib/http.js` (origem primeiro,
//    worker como reserva), e agora vale para a ferramenta que monta o indice tambem: sem
//    shard nao ha fallback em tempo de execucao, e o painel ainda e' a fonte.
//
// O que sobra sem indice e' o caminho de catalogo gzip em tempo de execucao, que o
// proprio log da fonte ja mostra ("caminho: catalogo gzip do painel (14978 itens,
// 5015274 B") — mais lento, dentro do teto, e por isso ALERTA e nao erro.
function rotasDe(painel, acao, extra, fonte) {
  const interna = `${baseDe(painel)}/player_api.php?username=${encodeURIComponent(painel.usuario)}&password=${encodeURIComponent(painel.senha)}&action=${acao}${extra || ""}`;
  const worker = workerDe(fonte);
  const porWorker = !DIRETO && worker ? `${worker}/proxy?url=${encodeURIComponent(interna)}` : "";
  return porWorker ? [porWorker, interna] : [interna];
}

// As rotas sao tentadas na ordem de `rotasDe` (worker, depois painel direto) e o PRIMEIRO
// que entregar JSON ganha. A rota que falhou entra no aviso do log, porque um shard gerado
// pelo caminho de reserva e' um shard valido — mas quem lê o log precisa saber que a rota
// preferida esta fora, senao um 403 do worker parece sucesso.
async function pegaJson(urls, cache) {
  const lista = Array.isArray(urls) ? urls : [urls];
  if (cache && USA_CACHE) {
    try {
      const texto = fs.readFileSync(path.join(CACHE_DIR, cache), "utf8");
      return { dados: JSON.parse(texto), bytes: texto.length, ms: 0, doCache: true };
    } catch (_) {}
  }
  const falhas = [];
  for (const url of lista) {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), 120e3);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      if (cache && USA_CACHE) {
        try {
          fs.mkdirSync(CACHE_DIR, { recursive: true });
          fs.writeFileSync(path.join(CACHE_DIR, cache), t);
        } catch (_) {}
      }
      const saida = { dados: JSON.parse(t), bytes: t.length, ms: Date.now() - t0 };
      if (falhas.length) saida.reserva = falhas.join(" | ");
      return saida;
    } catch (e) {
      falhas.push(`${String((e && e.message) || e).slice(0, 40)} em ${hostDe(url)}`);
    } finally {
      clearTimeout(relogio);
    }
  }
  const erro = new Error(`${falhas.length} rota(s) falharam: ${falhas.join(" | ")}`);
  erro.rotas = falhas;
  throw erro;
}

function hostDe(url) {
  try {
    return new URL(String(url)).hostname;
  } catch (_) {
    return "?";
  }
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

function norm(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function itemDe(x, serie) {
  const nome = String(x.name || x.title || "").trim();
  if (!nome) return null;
  const id = Number(serie ? x.series_id : x.stream_id);
  if (!Number.isFinite(id)) return null;
  const ext = String(x.container_extension || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return [id, norm(nome), nome, serie ? 1 : 0, anoDe(x.year || x.releaseDate || x.release_date, nome), ext];
}

function serializa(itens, fonte, chave, partes) {
  const ordenados = itens.slice().sort((a, b) => (String(a[1]) < String(b[1]) ? -1 : String(a[1]) > String(b[1]) ? 1 : a[0] - b[0]));
  return JSON.stringify({ v: 1, f: fonte, g: AGORA, k: chave, n: ordenados.length, it: ordenados });
}

function stubDe(fonte, chave, partes) {
  return JSON.stringify({ v: 1, f: fonte, g: AGORA, d: 1, k: chave, p: partes });
}

function letraDoItem(item) {
  return chaveDe(String(item[1] || ""));
}

function segundaDoItem(item) {
  const palavra = primeiraPalavra(String(item[1] || ""), true);
  const c = String(palavra || "").charAt(1) || "_";
  return /^[a-z0-9]$/.test(c) ? c : "_";
}

function apagaTudo(diretorio) {
  if (!fs.existsSync(diretorio)) return;
  for (const nome of fs.readdirSync(diretorio)) {
    const alvo = path.join(diretorio, nome);
    if (fs.statSync(alvo).isDirectory()) {
      apagaTudo(alvo);
      fs.rmdirSync(alvo);
    } else {
      fs.unlinkSync(alvo);
    }
  }
}

function escreve(fonte, relativo, conteudo) {
  const alvo = path.join(SAIDA, fonte, relativo);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo);
  return Buffer.byteLength(conteudo);
}

function sharda(fonte, itens) {
  const baldes = new Map();
  for (const item of itens) {
    const l = letraDoItem(item);
    if (!baldes.has(l)) baldes.set(l, []);
    baldes.get(l).push(item);
  }
  const arquivos = [];
  const letras = {};
  for (const [l, lista] of [...baldes.entries()].sort()) {
    const corpo = serializa(lista, fonte, l);
    if (Buffer.byteLength(corpo) <= ALVO) {
      const bytes = escreve(fonte, `${l}.json`, corpo);
      arquivos.push({ chave: `${l}.json`, bytes, itens: lista.length, nivel: 1 });
      letras[l] = { itens: lista.length, bytes, nivel: 1 };
      continue;
    }
    const sub = new Map();
    for (const item of lista) {
      const k = segundaDoItem(item);
      if (!sub.has(k)) sub.set(k, []);
      sub.get(k).push(item);
    }
    const partes = [];
    for (const [k, subLista] of [...sub.entries()].sort()) {
      const chave = `${l}/${l}${k}`;
      const subCorpo = serializa(subLista, fonte, chave);
      const bytes = escreve(fonte, `${chave}.json`, subCorpo);
      arquivos.push({ chave: `${chave}.json`, bytes, itens: subLista.length, nivel: 2 });
      partes.push(chave);
    }
    const bytesStub = escreve(fonte, `${l}.json`, stubDe(fonte, l, partes));
    arquivos.push({ chave: `${l}.json`, bytes: bytesStub, itens: 0, nivel: 0, stub: true });
    letras[l] = {
      itens: lista.length,
      bytes: Buffer.byteLength(corpo),
      nivel: 2,
      partes: partes.length,
      maiorParte: Math.max(...partes.map((p) => (arquivos.find((a) => a.chave === `${p}.json`) || {}).bytes || 0))
    };
  }
  return { arquivos, letras };
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

(async () => {
  const paineis = paineisDoAddon();
  console.log("[indice] credenciais lidas dos scrapers do plugin");
  console.log(`[indice] alvo por shard: ${ALVO} bytes (${(ALVO / 1024).toFixed(0)} KB)${SEM_ESCREVER ? " — MODO LEITURA: nada foi escrito" : ""}`);
  console.log(`[indice] saida: ${SAIDA}/<fonte>/<letra>.json  (via ${DIRETO ? "direto do painel" : "worker por fonte"}${USA_CACHE ? ", com cache em " + CACHE_DIR : ""})`);

  if (!SEM_ESCREVER) {
    apagaTudo(SAIDA);
    fs.mkdirSync(SAIDA, { recursive: true });
  }

  const relatorio = {};
  let totalItens = 0;
  let totalBytes = 0;
  // Uma fonte que perde o shard NAO pode derrubar o indice inteiro. MEDIDO 08/10/2026: o
  // `mirror-ato` respondeu `403 host not allowed` e o `throw` derrubou o processo DEPOIS de
  // BLZ e SPC ja terem gerado os shards — o `apagaTudo` do comeco tinha limpo o diretorio
  // anterior, entao o deploy perdia os tres. Perder uma fonte e' perda de velocidade na
  // consulta (o painel cai no catalogo gzip em tempo de execucao); perder todas e' nao ter
  // indice nenhum. O log diz qual fonte ficou sem shard, entao a queda e' visivel.
  const semShard = [];
  for (const fonte of FONTES) {
    if (SO && SO !== fonte) continue;
    const painel = paineis[fonte];
    let vod = null;
    let serie = null;
    try {
      vod = await pegaJson(rotasDe(painel, "get_vod_streams", "", fonte), `${fonte}-vod.json`);
      serie = await pegaJson(rotasDe(painel, "get_series", "", fonte), `${fonte}-ser.json`);
    } catch (e) {
      semShard.push(`${fonte} (${String((e && e.message) || e).slice(0, 90)})`);
      console.log(`[indice] ALERTA ${fonte} sem shard: ${String((e && e.message) || e).slice(0, 110)}`);
      console.log(`[indice]   a fonte continua funcionando: em tempo de execucao ela cai no catalogo gzip do painel`);
      continue;
    }
    const itens = [];
    for (const x of Array.isArray(vod.dados) ? vod.dados : []) { const it = itemDe(x, false); if (it) itens.push(it); }
    const vodN = itens.length;
    for (const x of Array.isArray(serie.dados) ? serie.dados : []) { const it = itemDe(x, true); if (it) itens.push(it); }
    const vistos = new Set();
    const unicos = itens.filter((it) => {
      const marca = `${it[3]}:${it[0]}`;
      if (vistos.has(marca)) return false;
      vistos.add(marca);
      return true;
    });
    const { arquivos, letras } = sharda(fonte, unicos);
    const maior = arquivos.reduce((a, b) => (b.bytes > a.bytes ? b : a), arquivos[0]);
    const bytes = arquivos.reduce((a, b) => a + b.bytes, 0);
    totalItens += unicos.length;
    totalBytes += bytes;
    relatorio[fonte] = {
      painel: baseDe(painel),
      via: vod.reserva ? "reserva (painel direto)" : DIRETO ? "direto" : workerDe(fonte) || "direto",
      viaReserva: vod.reserva || null,
      vod: vodN,
      serie: unicos.length - vodN,
      itens: unicos.length,
      bytes,
      arquivos: arquivos.length,
      maiorShard: { chave: maior.chave, bytes: maior.bytes, itens: maior.itens },
      letras,
      brutos: { vod: vod.bytes, serie: serie.bytes, msVod: vod.ms, msSerie: serie.ms }
    };
    console.log(
      `[indice] ${fonte.toUpperCase()} ${String(unicos.length).padStart(6)} itens (${vodN} filme + ${unicos.length - vodN} serie) | ` +
      `bruto ${mb(vod.bytes)}/${mb(serie.bytes)} em ${(vod.ms / 1000).toFixed(1)}s/${(serie.ms / 1000).toFixed(1)}s | ` +
      `indice ${mb(bytes)} em ${arquivos.length} arquivo(s) | maior shard ${maior.chave} ${(maior.bytes / 1024).toFixed(0)} KB (${maior.itens} itens)`
    );
    const grandes = Object.entries(letras).filter(([, v]) => v.nivel === 2);
    if (grandes.length) console.log(`[indice] ${fonte.toUpperCase()} letras em 2 niveis: ${grandes.map(([l, v]) => `${l}(${v.partes} partes, maior ${Math.round(v.maiorParte / 1024)} KB)`).join(", ")}`);
  }

  if (SEM_ESCREVER) {
    console.log("[indice] MODO LEITURA: nenhum arquivo escrito (use para medir antes de gravar).");
    return;
  }
  // NENHUMA fonte com shard e' erro de verdade: o `public/idx/` inteiro ficaria vazio e o
  // app cairia no catalogo gzip em TODAS as fontes de painel. Uma fonte sem shard e' perda
  // de velocidade so nela, e o relatorio + `indice.json` dizem exatamente qual.
  if (!Object.keys(relatorio).length) {
    console.error("[indice] erro: nenhuma fonte gerou shard — nada seria publicado");
    process.exit(1);
  }
  if (semShard.length) {
    console.log(`[indice] ${semShard.length} fonte(s) sem shard: ${semShard.join("; ")}`);
    console.log("[indice] elas continuam no manifesto e funcionam pelo catalogo gzip do painel");
  }
  const indice = { v: 1, geradoEm: AGORA, geradoEmIso: new Date().toISOString(), alvoBytes: ALVO, totalItens, totalBytes, semShard, fontes: relatorio };
  const bytesIndice = Buffer.byteLength(`${JSON.stringify(indice, null, 2)}\n`);
  fs.writeFileSync(path.join(SAIDA, "indice.json"), `${JSON.stringify(indice, null, 2)}\n`);
  console.log(`[indice] TOTAL ${totalItens} itens em ${mb(totalBytes)} + ${(bytesIndice / 1024).toFixed(1)} KB de indice.json`);
  console.log(`[indice] maior shard do conjunto: ${(Math.max(...FONTES.filter((f) => relatorio[f]).map((f) => relatorio[f].maiorShard.bytes)) / 1024).toFixed(0)} KB (teto do runtime: ${(TETO_CORPO_BYTES / 1024).toFixed(0)} KB)`);
  console.log("[indice] fontes com shard sao as do registro que tem `idx` (src/core/fontes/): " + FONTES.join(", "));
  console.log("[indice] kkt NAO entra: e o mesmo painel do blz (kakito.xyz, mesmas credenciais) e o dedup por host+path do addon ja colapsa os dois — indexar seria 48,8 MB de M3U para os mesmos arquivos.");
})().catch((e) => {
  console.error("[indice] erro:", e && e.message ? e.message : e);
  process.exit(1);
});
