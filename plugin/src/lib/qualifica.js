// Preenche a qualidade REAL dos streams que a fonte entregou sem ela.
//
// POR QUE EXISTE — medido no app do Nuvio: quando o scraper nao manda `quality`, o
// app escreve na linha 1 o rotulo de localizacao `stream_quality_unknown`, que em
// pt-BR e "Desconhecido". MEDIDO nas 11 fontes antes deste modulo: 13 das 15
// devolviam stream sem `quality`, entao quase toda linha da tela dizia "Desconhecido"
// — inclusive as fontes que sabiam a resolucao pelo nome do item do catalogo.
//
// POR QUE NAO INVENTAR — o projeto ja tem essa regra (decisao 36 do addon): a
// qualidade e a RESOLUCAO REAL lida do video. Aqui nao existe rotulo padrao. Se a
// leitura falhar, o campo continua vazio e a linha repete o que o app escreve —
// honesto, e igual ao que era antes deste modulo. Por isso tambem NAO se propaga a
// resolucao de um stream para os outros da mesma fonte: um painel pode ter 720p e
// 1080p do mesmo filme, e preencher os dois com uma leitura seria inventar.
//
// CUSTO — uma leitura de 160 KB por stream, em paralelo, com teto. O runtime corta
// corpo em 1 MB e a leitura pede 160 KB, entao sobra. O teto de sondas evita que uma
// fonte com 12 streams pague 12 leituras: as 3 primeiras definem o que a lista mostra
// e o resto vai sem rotulo, como ia antes.
//
// O teto de 5,0 s por sonda tambem e medido, nao arbitrario. MEDIDO: a leitura no SPC
// leva 358-514 ms e entrega 1920x800 (1080p); no BLZ a origem leva 3319/3423/3307 ms
// para devolver os 160 KB do Range. O teto antigo de 3000 ms cortava a sonda antes de
// ela terminar — o BLZ saia sem rotulo e o app escrevia "Desconhecido", que e'
// exatamente o defeito deste modulo. O seguinte, de 3500 ms, cobria a pior medicao por
// 77 ms (3500 menos 3423), e folga de moeda nao e' orcamento: MEDIDO ela caiu — numa
// rodada da bateria o BLZ perdeu a corrida e a saida imprimiu `contrato quebrado: 3`,
// com o BLZ marcado `bloqueado`, sendo que e' a fonte que FUNCIONA. Agora MS_SONDA =
// 5000 cobre esses 3423 ms medidos por 1577 ms. As sondas rodam em paralelo dentro de
// um MESMO `Promise.all`, entao o custo e' o da maior sonda, nao a soma: um
// `getStreams` frio paga no maximo 1,5 s a mais que o orcamento anterior (TETO_MS 4500
// -> 6000), e so quando uma origem e lenta de verdade. Acima deles continua valendo o
// mesmo calculo de sempre: origem que precisa de mais de 5 s para devolver 160 KB
// tambem vai demorar para o usuario, e nao vale pagar esse atraso no `getStreams` para
// ganhar um rotulo.
//
// O TETO_MS tem de ficar ACIMA do MS_SONDA: o TETO_MS e' o orcamento da invocacao
// INTEIRA e o MS_SONDA e' o de CADA sonda. Com o teto menor que a sonda e' o teto
// que corta primeiro, o numero por sonda nunca e' alcancado, e o teto de verdade
// passa a ser o outro — a ordem dos dois e' o que decide quanto a sonda recebe.
//
// O `ms` e o que SOBRA do orcamento da invocacao, nunca um numero fixo: quem chama
// ja pode ter gasto 20 s num painel lento e nao pode perder os 5 s da sonda aqui.
//
// O MOTIVO — o campo vazio deixa de ser um silencio. Sao CINCO palavras, nem uma a
// mais, e cada uma diz o que a chamada OBSERVOU, nunca o que ela suspeita da origem:
//
//   `timeout`       — a sonda devolveu `null` DEPOIS de consumir os ms que recebemos
//                     (`Date.now() - t0 >= ms`): cortamos na origem, e e' tudo o que
//                     sabemos daqui. Um lancamento que cita tempo tambem vira aqui.
//   `sem-video`     — a sonda devolveu `null` ANTES de consumir o orcamento: a origem
//                     respondeu e nao trouxe quadro nenhum.
//   `bloqueado`     — a sonda LANCOU mensagem com status HTTP (302, 403, 429...): uma
//                     recusa cujo codigo VIMOS. E' o unico caminho desta palavra — e
//                     MEDIDO que hoje ele quase nao dispara: `video-probe.js` engole
//                     todo erro interno e devolve `null` (o 403 dele e' lancado na
//                     linha 361 e capturado antes de sair), entao contra a sonda real
//                     so `timeout`, `sem-video` e `sem-orcamento` chegam. A palavra
//                     fica porque depende de a sondagem PROPAGAR a recusa em vez de
//                     engolir — enquanto engole, uma recusa e' indistinguivel de
//                     "respondeu e nao trouxe quadro".
//   `sem-orcamento` — a sobra caiu abaixo do MIN_MS e a sonda nem comecou.
//   `erro`          — a sonda lancou sem status e sem tempo: falha de rede.
//
// POR QUE A FAIXA DE 500 MS SAIU — ela separava "respondeu rapido" de "demorou", e
// "demorou" virava `bloqueado`: era o relogio acusando a origem sem ter visto nenhuma
// recusa. MEDIDO, isso acusou o BLZ (3423 ms, a fonte que funciona) de bloqueio de IP.
// Com o orcamento na mao o teste honesto e' um so: consumiu os ms que demos (cortamos)
// ou devolveu antes (respondeu). Uma faixa no meio reapresentaria a mesma suposicao com
// outro numero.
//
// `motivos()` devolve `{ chaveDe(stream): motivo }`, e quem le o campo vazio pode
// imprimir tambem o por que dele. Duas regras junto: gravar motivo NUNCA enche
// `stream.quality` (rotulo sem leitura seria invencao, decisao 36) e NUNCA tira stream
// da lista. Quem ficou de fora do teto de 3 sondas nao tem motivo: nao foi lido, entao
// nao ha o que dizer — a resposta continua a de antes.
//
// O SNAPSHOT NA LISTA — alem do registro global (`motivos()`), a PROPRIA lista que sai
// daqui carrega `lista.motivos`: `{ chaveDe(stream): motivo }` copiado NO INSTANTE do
// retorno. Ele nao e' o mapa inteiro do modulo, que acumula chamadas anteriores: so tem
// os streams que ESTA lista mandou sondar, e o que o teto cortou fica de fora — nao foi
// lido, nao ha o que dizer. Assim quem le a lista ja tem o por que do campo vazio sem
// uma SEGUNDA medicao: o motivo e' o mesmo que produziu aquele vazio. A propriedade vai
// na LISTA e nunca no stream: `JSON.stringify` de um array emite so os elementos
// indexados (nao vaza para o serializador do app) e o `LocalScraperResult` do Nuvio e
// data class do Moshi, onde campo a mais no stream quebra o parse em runtime.
// Os caminhos que nao sondam (`nunca`, lista que nao e' array, lista vazia, lista sem
// campo vazio) devolvem a lista SEM `motivos` — quem le trata ausente como `{}`.

const { novo } = require("../core/sandbox");
const { videoResolutionToQuality } = require("./quality");
const { probeResolution } = require("./video-probe");

// 3 sondas x 160 KB = 480 KB. Abaixo do teto de 1 MB do runtime, e em paralelo.
const MAX_SONDAS = 2;
const MS_SONDA = 5000;
const TETO_MS = 6000;
const MIN_MS = 800;

const cache = new Map();
const CACHE_MAX = 120;

const motivosRegistrados = new Map();

// O lancamento e' o UNICO caminho do `bloqueado`: e' a recusa cujo status VIMOS na
// mensagem. O caminho nulo nunca mais acusa bloqueio (ver o cabecalho).
//
// Status HTTP citado no fim (`...: 302`) ou como `HTTP 403`. O `falha de rede em
// <url>: <cause>` termina no cause, entao `ECONNRESET` nao casa; e o `:443` de uma URL
// tambem nao, porque fica no meio do caminho e nao antes do fim.
const TEM_STATUS = /(?:^|\s)(?:HTTP\s*)?[1-5]\d{2}(?:\s|$)/;

function motivoDoLancamento(e) {
  const msg = String((e && e.message) || e);
  if (/timeout/i.test(msg)) return "timeout";
  if (TEM_STATUS.test(msg)) return "bloqueado";
  return "erro";
}

// O POR QUE de cada campo vazio, por `chaveDe(stream)`. Copia para fora: quem le
// nao pode mexer no registro.
function motivos() {
  return Object.fromEntries(motivosRegistrados);
}

// A chave inclui os cabecalhos: a mesma URL com e sem `Referer` pode servir codigos
// diferentes, e o RTD e exatamente esse caso.
function chaveDe(stream) {
  const h = (stream && stream.headers) || {};
  const partes = Object.keys(h).sort().map((k) => `${k}=${h[k]}`);
  return partes.length ? `${stream.url}|${partes.join("&")}` : String(stream.url);
}

function modo() {
  const bruto = globalThis.MIRROR_QUALIDADE;
  const v = bruto === null || bruto === void 0 ? "auto" : String(bruto).trim().toLowerCase();
  return ["auto", "nunca", "sempre"].includes(v) ? v : "auto";
}

async function qualidadeDe(stream, ms) {
  const chave = chaveDe(stream);
  if (cache.has(chave)) return cache.get(chave);
  let qualidade = null;
  const t0 = Date.now();
  try {
    const r = await probeResolution(stream.url, {
      headers: stream.headers || {},
      maxTargets: 1,
      ms
    });
    if (r) {
      // Leu dimensoes: o motivo antigo, se havia, ja nao vale.
      motivosRegistrados.delete(chave);
      qualidade = videoResolutionToQuality(r.width, r.height);
    } else {
      // `null` e' a sonda calada; o RELOGIO e' o que separa o que vimos. Consumiu o
      // orcamento inteiro => cortamos na origem => `timeout`. Devolveu antes => a
      // origem respondeu e nao trouxe quadro => `sem-video`. Entre os dois nao ha
      // terceiro caso: a faixa de 500 ms saiu (ver o cabecalho).
      motivosRegistrados.set(chave, Date.now() - t0 >= ms ? "timeout" : "sem-video");
    }
  } catch (e) {
    qualidade = null;
    motivosRegistrados.set(chave, motivoDoLancamento(e));
  }
  if (qualidade) {
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(chave, qualidade);
  }
  return qualidade;
}

/**
 * Roda a fonte e preenche a qualidade dos streams que sairam sem ela.
 * `chamar` e o `getStreams` original: nada aqui muda a DECISAO da fonte sobre
 * entregar ou nao link, so completa o rotulo depois.
 *
 * A lista que sai daqui carrega `lista.motivos` — o snapshot do POR QUE de cada campo
 * vazio, so para o que ESTA chamada sondou (ver o cabecalho). Os caminhos que nao
 * sondam devolvem a lista sem a propriedade; quem le trata ausente como `{}`.
 */
async function qualificaLista(lista) {
  const modoAtual = modo();
  if (modoAtual === "nunca" || !Array.isArray(lista) || !lista.length) return lista;

  const semQualidade = lista.filter(
    (s) => s && typeof s.url === "string" && /^https?:/i.test(s.url) && !s.quality
  );
  if (!semQualidade.length) return lista;

  const teto = modoAtual === "sempre" ? lista.length : MAX_SONDAS;
  const sondados = semQualidade.slice(0, teto);
  const p = novo(TETO_MS);
  const resultados = await Promise.all(
    sondados.map(async (s) => {
      const sobra = Math.min(MS_SONDA, p.sobra());
      if (sobra < MIN_MS) {
        motivosRegistrados.set(chaveDe(s), "sem-orcamento");
        return null;
      }
      return qualidadeDe(s, sobra);
    })
  );
  sondados.forEach((s, i) => {
    if (resultados[i]) s.quality = resultados[i];
  });
  // O SNAPSHOT: so o que ESTA chamada sondou, copiado do registro no instante do
  // retorno. Nao e' o mapa inteiro do modulo (ele guarda historico de chamadas
  // anteriores), entao um stream que o teto cortou fica de fora — nao foi lido, nao ha
  // o que dizer. Vai na LISTA, nunca no stream.
  const destaChamada = {};
  for (const s of sondados) {
    const chave = chaveDe(s);
    if (motivosRegistrados.has(chave)) destaChamada[chave] = motivosRegistrados.get(chave);
  }
  lista.motivos = destaChamada;
  return lista;
}

async function qualifica(chamar, ...args) {
  return qualificaLista(await chamar(...args));
}

module.exports = { MAX_SONDAS, MS_SONDA, TETO_MS, cache, chaveDe, motivos, qualidadeDe, qualifica, qualificaLista };
