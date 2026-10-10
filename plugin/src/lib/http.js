const { TEMPO_FETCH_PADRAO_MS, TEMPO_FETCH_MAX_MS } = require("../core/sandbox");
const { BACKOFF_MS, RETRIES, deveTentarEdge, workerDe } = require("../core/politica");

function comPrazo(res, controle, alvo, ms, relogio) {
  const estouroDoCorpo = () => new Error(`timeout de ${ms}ms em ${alvo}`);
  const corpo = (fn) => (...args) => {
    clearTimeout(relogio.t);
    relogio.t = setTimeout(() => { try { controle.abort(); } catch (_) {} }, ms);
    const leitura = Promise.resolve().then(() => fn.apply(res, args)).catch((e) => {
      if (controle.signal.aborted) throw estouroDoCorpo();
      throw e;
    });
    const estouro = new Promise((_, recusa) => {
      relogio.aviso = setTimeout(() => recusa(estouroDoCorpo()), ms);
    });
    return Promise.race([leitura, estouro]).finally(() => {
      clearTimeout(relogio.t);
      clearTimeout(relogio.aviso);
    });
  };
  const metodo = (nome) => (typeof res[nome] === "function" ? corpo(res[nome].bind(res)) : undefined);
  return {
    get ok() { return res.ok; },
    get status() { return res.status; },
    get statusText() { return res.statusText; },
    get url() { return res.url; },
    get redirected() { return res.redirected; },
    get type() { return res.type; },
    headers: res.headers,
    body: res.body,
    text: metodo("text"),
    json: metodo("json"),
    arrayBuffer: metodo("arrayBuffer"),
    blob: metodo("blob")
  };
}

async function fetchUma(alvo, init, ms) {
  const controle = new AbortController();
  const pedido = { ...init, signal: controle.signal };
  const relogio = { t: null, aviso: null };
  let motivo = null;
  try {
    const tarefa = fetch(alvo, pedido);
    tarefa.catch(() => {});
    const estouro = new Promise((_, recusa) => {
      relogio.t = setTimeout(() => {
        motivo = "timeout";
        try { controle.abort(); } catch (_) {}
      }, ms);
      relogio.aviso = setTimeout(() => recusa(new Error(`timeout de ${ms}ms em ${alvo}`)), ms);
    });
    const resposta = await Promise.race([tarefa, estouro]);
    return comPrazo(resposta, controle, alvo, ms, relogio);
  } catch (e) {
    if (motivo === "timeout" || controle.signal.aborted) throw new Error(`timeout de ${ms}ms em ${alvo}`);
    throw new Error(`falha de rede em ${alvo}: ${e && e.message ? e.message : String(e)}`);
  } finally {
    clearTimeout(relogio.t);
    clearTimeout(relogio.aviso);
  }
}

function erroTransitório(error) {
  return /timeout|falha de rede|fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|aborted/i.test(String(error && error.message || error));
}
async function esperar(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }

async function pegar(url, opcoes) {
  const o = opcoes || {};
  const alvo = String(url || "");
  const ms = Math.max(1, Math.min(Number(o.ms || TEMPO_FETCH_PADRAO_MS) || TEMPO_FETCH_PADRAO_MS, TEMPO_FETCH_MAX_MS));
  const init = { method: String(o.metodo || "GET"), headers: Object.assign({}, o.headers || {}) };
  if (o.corpo !== void 0 && o.corpo !== null) init.body = o.corpo;
  if (o.redirect) init.redirect = o.redirect;
  // O `ref` da reserva vem do `Referer` que o CHAMADOR passou nesta mesma chamada: o worker
  // nao repassa cabecalho de requisicao, so o parametro. Sem isto o fallback cai na mesma
  // recusa que a origem deu. Ver `workerDe` em `src/core/politica.js`.
  const worker = workerDe(alvo, init.headers.Referer || init.headers.referer);
  let direto = null;
  let ultimoErro = null;

  for (let tentativa = 0; tentativa <= RETRIES; tentativa += 1) {
    try {
      direto = await fetchUma(alvo, init, ms);
      if (!deveTentarEdge(direto.status) || tentativa === RETRIES || worker) break;
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa === RETRIES || worker || !erroTransitório(erro)) break;
    }
    await esperar(BACKOFF_MS * Math.max(1, tentativa + 1));
  }

  if (!direto && worker) {
    try {
      console.log(`[edge] fallback worker para ${new URL(alvo).hostname}: ${ultimoErro && ultimoErro.message || "falha direta"}`);
      return await fetchUma(worker, init, ms);
    } catch (_) {}
  }
  if (!direto && ultimoErro) throw ultimoErro;

  if (direto && worker && deveTentarEdge(direto.status)) {
    for (let tentativa = 0; tentativa < RETRIES; tentativa += 1) {
      try {
        console.log(`[edge] fallback worker para ${new URL(alvo).hostname}: HTTP ${direto.status}`);
        return await fetchUma(worker, init, ms);
      } catch (_) {
        if (tentativa + 1 < RETRIES) await esperar(BACKOFF_MS * Math.max(1, tentativa + 1));
      }
    }
  }
  return direto;
}

async function pegarTexto(url, opcoes) {
  const res = await pegar(url, opcoes);
  const texto = await res.text();
  return { ok: !!res.ok, status: res.status, texto, url: String(res.url || url) };
}
async function pegarJson(url, opcoes) {
  const r = await pegarTexto(url, opcoes);
  const cru = String(r.texto || "").trim();
  if (!cru) return { ok: r.ok, status: r.status, dados: null };
  try {
    return { ok: r.ok, status: r.status, dados: JSON.parse(cru) };
  } catch (e) {
    if (r.ok) throw new Error(`JSON invalido em ${url}: ${e && e.message ? e.message : String(e)}`);
    return { ok: false, status: r.status, dados: null };
  }
}
module.exports = { pegar, pegarTexto, pegarJson, workerUrlDe: workerDe };
