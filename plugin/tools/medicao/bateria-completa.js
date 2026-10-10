// Bateria COMPLETA: as 11 fontes, N casos cada, ponta a ponta.
//
//   node tools/medicao/bateria-completa.js                 # tudo
//   node tools/medicao/bateria-completa.js vod             # so VOD/anime/dorama
//   node tools/medicao/bateria-completa.js vzr blz         # so essas fontes
//   CONC=3 node tools/medicao/bateria-completa.js          # menos casos por fonte
//
// O que ela mede, por fonte e por caso:
//
//   1. TEMPO      — quanto a fonte leva do `getStreams` ate devolver a lista. E o que
//                   o usuario espera na tela antes de o primeiro player aparecer.
//   2. ENTREGA    — devolveu stream? lancou erro? Erro e diferente de `[]`: erro
//                   marca a fonte como "com erro" no app, `[]` e "sem fonte".
//   3. CONTRATO   — o objeto que o Nuvio vai ler. Confere o que o app DELE:
//                   `name` (linha 1), `quality` (que o app usa para completar a
//                   linha 1 e para ordenar), `title` (linha 2) e `url`. Sem `quality`
//                   o app escreve "Desconhecido" — ver `src/lib/apresentacao.js`.
//                   Quando a lista traz em `lista.motivos` o POR QUE da leitura ter
//                   vindo vazia, a falha sai com o motivo; sem motivo, a frase e a de
//                   sempre.
//   4. QUALIDADE  — quantos streams sairam com a resolucao REAL lida do video.
//   5. VIVO       — Range de 2 KB no link, com os mesmos cabecalhos que o player
//                   manda. `INDECISO` (429) e `BLOQUEADO` (recusa a IP de
//                   datacenter) NAO contam como morto: sao situacoes em que o link
//                   pode tocar no aparelho do usuario e nao da para provar daqui.
//
// NADA aqui e bundlado: e tooling Node.
//
// O MOTIVO DE QUALIDADE VAZIO vem da PROPRIA lista que o bundle devolveu. O embrulho
// gerado no build e `getStreams: (...args) => qualifica(base.getStreams, ...args)`, e o
// `qualifica` grava `lista.motivos` antes de retornar — { chaveDe(stream): motivo } com
// os motivos da sonda DESTA chamada, copiados no instante do retorno. A propriedade nasce
// no array, atravessa a fronteira do bundle no mesmo realm de JS e a bateria le direto:
// nada de segunda medicao, nada de copia — o motivo e' o MESMO que produziu aquele campo
// vazio. Um stream que o teto de 3 sondas cortou nao tem entrada no snapshot da propria
// lista e sai com a frase de sempre, que e' o que a regra pede. `JSON.stringify` de um
// array emite so os elementos indexados, entao a propriedade nao vaza para o serializador
// do app; e ela e' da LISTA, nunca de um stream (o `LocalScraperResult` do Nuvio e data
// class do Moshi, campo a mais no stream quebraria o parse em runtime).

const path = require("path");
const { RAIZ } = require("../_caminhos");
const fontes = require("../../src/core/fontes");
const { chaveTmdb, PADRAO, casosDosArgs } = require("./casos");
const { um: provar } = require("./provar-links");
const { chaveDe } = require("../../src/lib/qualifica");

const chave = chaveTmdb();
if (chave) globalThis.TMDB_API_KEY = chave;
if (process.env.MIRROR_INDEX_BASE) globalThis.MIRROR_INDEX_BASE = String(process.env.MIRROR_INDEX_BASE).replace(/\/+$/, "");

const TEMPOS = [2500, 5000, 10000, 15000, 25000, 35000, 60000];
const CONC_PADRAO = 3;

// A frase de cada motivo registrado em `qualifica`. Sem motivo, a mensagem continua a
// de sempre — quem nao foi sondado (teto de 3) nao tem o que dizer.
const FRASES = {
  bloqueado: "bloqueado por IP de datacenter",
  "sem-video": "origem respondeu sem quadro de video",
  "sem-orcamento": "orcamento esgotado antes da sonda",
  timeout: "tempo esgotado na leitura",
  erro: "erro na leitura da sonda"
};

function classeDe(ms) {
  let i = 0;
  while (i < TEMPOS.length - 1 && ms > TEMPOS[i]) i += 1;
  return i;
}

// O que o app FAZ com o objeto. Medido em `StreamRepositoryImpl.toPluginStream`:
// a linha 1 e `name` e o app acrescenta " - <quality>"; quando `quality` vem
// vazio, ele escreve o rotulo de localizacao do device. O mesmo contrato esta em
// `src/lib/apresentacao.js` — aqui a bateria so confere que a fonte obedeceu.
// `motivosDaLista` e o snapshot que o `qualifica` gravou na lista (`lista.motivos`):
// sem ele a frase continua a de sempre.
function confereContrato(fonte, stream, motivosDaLista) {
  const falta = [];
  if (!stream || typeof stream !== "object") return ["nao e objeto"];
  if (typeof stream.url !== "string" || !/^https?:\/\//i.test(stream.url)) falta.push("url ausente ou nao http(s)");
  if (typeof stream.name !== "string" || !stream.name.trim()) falta.push("name vazio (linha 1)");
  if (typeof stream.title !== "string" || !stream.title.trim()) falta.push("title vazio (linha 2)");
  if (!fonte.conteudos.includes("tv") && !stream.quality) {
    const motivo = (motivosDaLista || {})[chaveDe(stream)];
    falta.push(motivo ? `sem quality (${FRASES[motivo] || motivo})` : "sem quality (o app escreve 'Desconhecido')");
  }
  const sigla = fonte.sigla;
  if (!String(stream.title || "").includes(sigla)) falta.push(`title sem a sigla ${sigla}`);
  // Campos que o runtime do Nuvio NAO conhece: o LocalScraperResult e um data class
  // do Moshi, e campo a mais pode fazer o parse falhar em runtime.
  const ACEITOS = new Set([
    "name", "title", "description", "url", "quality", "size", "language", "provider",
    "type", "seeders", "peers", "infoHash", "headers", "subtitles"
  ]);
  for (const campo of Object.keys(stream)) {
    if (!ACEITOS.has(campo)) falta.push(`campo "${campo}" nao existe no LocalScraperResult do Nuvio`);
  }
  return falta;
}

async function rodaCaso(fonte, caso, rotulo) {
  const modulo = path.join(RAIZ, "dist", fontes.bundleDe(fonte));
  const t0 = Date.now();
  let lista = null;
  let erro = "";
  try {
    const mod = require(modulo);
    lista = await mod.getStreams(caso[0], caso[1], caso[2], caso[3]);
  } catch (e) {
    erro = String((e && e.message) || e);
  }
  const ms = Date.now() - t0;
  const reg = fontes.FONTES[fonte];
  const linha = { fonte, rotulo, caso: caso.join(" "), ms, classe: classeDe(ms), streams: 0, erro: "", vivos: 0, comQualidade: 0, falta: [] };
  if (erro) {
    linha.streams = -1;
    linha.erro = erro;
    return linha;
  }
  if (!Array.isArray(lista)) {
    linha.streams = -2;
    linha.erro = `devolveu ${typeof lista}, nao lista`;
    return linha;
  }
  linha.streams = lista.length;
  if (!lista.length) return linha;
  // O motivo do campo vazio vem do snapshot que o `qualifica` do BUNDLE gravou na
  // propria lista (`lista.motivos`), lido depois do relogio do caso: `tempo`, `streams`
  // e `qual` continuam sendo a medida do bundle, e o motivo e' o da sonda que produziu
  // aquele vazio (ver o cabecalho). Sem snapshot, a frase e a de sempre.
  const motivosDaLista = lista.motivos || {};
  for (const s of lista) linha.falta.push(...confereContrato(reg, s, motivosDaLista));
  linha.comQualidade = lista.filter((s) => s && s.quality).length;
  const alvos = lista.slice(0, 2);
  const conc = 2;
  const res = [];
  for (let i = 0; i < alvos.length; i += conc) {
    res.push(...(await Promise.all(alvos.slice(i, i + conc).map(provar))));
  }
  linha.vivos = res.filter((r) => ["ok", "INDECISO", "BLOQUEADO"].includes(r.veredito)).length;
  linha.provas = res.map((r) => `${r.veredito}/${r.status}`).join(" ");
  return linha;
}

// Todos os casos de VOD sao por titulo (o `PADRAO` do registro, que aceita "a|b").
// O plugin mede apenas VOD: filmes, séries, anime e doramas.
async function casosDe(fonte) {
  const base = PADRAO[fonte];
  if (!base) return [];
  return String(base[0]).split("|").map((t) => ({
    caso: [t.trim(), base[1], base[2], base[3]],
    rotulo: t.trim()
  }));
}

function cabecalho() {
  console.log("fonte  caso              tempo  classe  streams  qual  vivos  contrato");
}

function linhaDe(l) {
  const tempo = `${l.ms}ms`;
  const estado = l.streams === -1 ? `LANCOU (${l.erro.slice(0, 40)})`
    : l.streams === -2 ? l.erro
    : `${l.streams}`;
  const contrato = l.falta.length ? `FALHA: ${[...new Set(l.falta)].slice(0, 2).join("; ")}` : "ok";
  return `${l.fonte.padEnd(5)} ${String(l.rotulo).slice(0, 16).padEnd(17)} ${tempo.padStart(6)} ${String(l.classe).padStart(5)}  ${estado.padStart(7)} ${String(l.comQualidade).padStart(5)} ${String(l.vivos).padStart(6)}  ${contrato}`;
}

(async () => {
  const argv = process.argv.slice(2);
  const so = argv.filter((a) => !a.includes("/") && fontes.FONTES[a]).map((a) => a);
  const grupos = argv.filter((a) => a === "vod");
  let lista = fontes.chaves();
  if (so.length) lista = so;
  else if (grupos.length) lista = lista.filter((k) => fontes.grupo(k) === "vod");

  const conc = Number(process.env.CONC) || CONC_PADRAO;
  const todos = [];
  let i = 0;
  for (const fonte of lista) {
    const casos = (await casosDe(fonte)).slice(0, conc);
    for (const c of casos) {
      const l = await rodaCaso(fonte, c.caso, c.rotulo);
      todos.push(l);
      console.log(linhaDe(l));
      i += 1;
    }
  }

  console.log("\n═══ resumo");
  const tentados = todos;
  const comRede = tentados.filter((l) => l.streams >= 0 && l.streams > 0);
  const entregues = tentados.filter((l) => l.streams > 0).length;
  const lancaram = tentados.filter((l) => l.streams === -1);
  const quebradas = tentados.filter((l) => l.streams > 0 && l.falta.length);
  const semQualidade = comRede.filter((l) => l.comQualidade === 0);
  const semLinkVivo = comRede.filter((l) => l.vivos === 0);
  const vazias = tentados.filter((l) => l.streams === 0);
  const porFonte = new Map();
  for (const l of comRede) {
    const at = porFonte.get(l.fonte) || { tot: 0, com: 0, ms: [] };
    at.tot += 1;
    if (l.vivos > 0) at.com += 1;
    at.ms.push(l.ms);
    porFonte.set(l.fonte, at);
  }
  console.log(`casos: ${todos.length}  | tentados: ${tentados.length}`);
  console.log(`com stream: ${entregues}/${tentados.length} | lancou erro: ${lancaram.length} | devolveu vazio: ${vazias.length} | contrato quebrado: ${quebradas.length}`);
  console.log(`sem nenhum link vivo: ${semLinkVivo.length} de ${comRede.length}`);
  console.log(`sem qualidade real: ${semQualidade.length} de ${comRede.length}`);
  console.log("\npor fonte (com stream):");
  for (const [f, at] of porFonte) {
    const media = Math.round(at.ms.reduce((a, b) => a + b, 0) / at.ms.length);
    const pior = Math.max(...at.ms);
    console.log(`  ${f.padEnd(5)} ${String(at.com).padStart(2)}/${String(at.tot).padEnd(2)} com link vivo | media ${media}ms | pior ${pior}ms`);
  }
  if (vazias.length) {
    console.log("\nrespondeu VAZIO depois de tentar (a fonte tem o item e nao entregou):");
    vazias.forEach((l) => console.log(`  ${l.fonte} [${l.rotulo}] ${l.caso}`));
  }
  if (lancaram.length) {
    console.log("\nfontes que LANCARAM erro (o app marca como 'com erro', nao 'sem fonte'):");
    lancaram.forEach((l) => console.log(`  ${l.fonte} [${l.rotulo}] ${l.erro}`));
  }
  if (quebradas.length) {
    console.log("\nCONTRATO quebrado:");
    [...new Set(quebradas.flatMap((l) => l.falta.map((f) => `${l.fonte}: ${f}`)))].forEach((x) => console.log(`  ${x}`));
  }
  if (semQualidade.length) {
    console.log("\nsem qualidade real (a linha 1 vai escrever 'Desconhecido'):");
    const porFonte2 = {};
    for (const l of semQualidade) porFonte2[l.fonte] = (porFonte2[l.fonte] || 0) + 1;
    console.log("  " + Object.entries(porFonte2).map(([k, v]) => `${k}:${v}`).join("  "));
  }
})();
