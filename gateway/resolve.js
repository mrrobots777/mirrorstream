"use strict";

// Orquestração do gateway (Task 6, spec §5): uma consulta `resolve(requisicao)`
// percorre cache positivo → cache negativo → coalescimento → todas as fontes
// elegíveis (ou a preferida) → orçamento → `agruparStreams` → cache; só uma
// preferência vazia abre reserva. Regrava o resultado completo em background.
// Módulo puro de Node: zero dependência npm — concorrência e orçamento são
// `Promise` primitivas.
//
// `chamaFonte` é injetável (spec §5: teste sem rede); a rejeição dela conta
// como falha da fonte, nunca como erro da consulta. As duas regras que o texto
// do fluxo não diz e os testes prendem:
//   * `metricas.resolve(…)` recebe o rótulo MINÚSCULO ("hit", "miss",
//     "parcial", "negativo"); o corpo da resposta leva o valor MAIÚSCULO.
//   * Falha TOTAL não vira negativo: se TODAS as fontes consultadas erraram
//     (lançou ou estourou timeout) e nenhuma respondeu limpo, a resposta é
//     `streams: []` com `cache: "MISS"` e nada é gravado (spec §6/§9 — "os
//     painéis estão fora" não é "nenhuma fonte tem este título").
const { agruparStreams } = require("../plugin/src/lib/agregador");
const { qualificaLista } = require("../plugin/src/lib/qualifica");

const MAX_RESERVA_PREFERIDA = 2;     // MAX_FONTES_FALLBACK_PREFERIDA
const TIMEOUT_FONTE_MS = 8000;       // TIMEOUT_FONTE
const TETO_QUALIFICA_MS = 5000;      // teto do qualificaLista por lista
const TTL_COMPLETO_MS = 300000;      // positivo completo (spec §6)
const TTL_PARCIAL_MS = 15000;        // positivo parcial, respondido no orçamento
const TTL_NEGATIVO_MS = 30000;       // negativo (spec §6)

// `preferida` chega como `bingeGroup` do Nuvio ("mirrorstream:spc"); o plugin
// já a traduz no aparelho, mas aceitar as duas grafias custa uma linha e não
// pode transformar resolução em vazio por causa de um prefixo.
function normalizaPreferida(valor) {
  return String(valor ?? "").trim().toLowerCase().replace(/^mirrorstream:/, "");
}

function chaveDeCache(req) {
  return `${req.id}|${req.tipo}|${req.temporada ?? ""}|${req.episodio ?? ""}|${req.preferida ?? ""}`;
}

function criaResolve(dependencias) {
  const { fontes, estado, cache, metricas, orcaMs } = dependencias;
  const agora = dependencias.agora ?? Date.now;
  // Contrato: `async (chave, req) => any[]`. O padrão é o scraper registrado —
  // os argumentos são os mesmos que o bundle agregado passava.
  const chama = dependencias.chamaFonte ?? ((chave, req) => {
    const entrada = fontes.elegiveis(req.tipo).find((f) => f.chave === chave);
    if (!entrada) return Promise.reject(new Error(`fonte não elegível: ${chave}`));
    return entrada.getStreams(req.id, req.tipo, req.temporada ?? null, req.episodio ?? null);
  });

  async function resolve(requisicao) {
    const inicio = agora();
    const chaveCache = chaveDeCache(requisicao);
    const guardado = cache.pega(chaveCache);
    if (guardado) {
      const streams = Array.isArray(guardado.streams) ? guardado.streams : [];
      const rotulo = streams.length ? "hit" : "negativo";
      metricas.resolve(rotulo);
      const ms = agora() - inicio;
      metricas.resposta(ms);
      return { streams, fontes: [], cache: rotulo.toUpperCase(), ms };
    }
    // Coalescimento: consultas idênticas em voo reusam a MESMA promessa
    // (spec §6). A entrada sai em `finally` dentro de `emVoo`.
    return cache.emVoo(chaveCache, () => produz(requisicao, inicio, chaveCache));
  }

  async function produz(req, inicio, chaveCache) {
    const restante = () => Math.max(0, orcaMs - (agora() - inicio));

    // Seleção: todas as fontes elegíveis do tipo, filtradas por cooldown (§7 —
    // sem nenhuma saudável, todas voltam a ser candidatas), na ORDEM do registro.
    const elegiveis = fontes.elegiveis(req.tipo);
    const candidatas = new Set(estado.candidatas(elegiveis.map((f) => f.chave)));
    const saudaveis = elegiveis.filter((f) => candidatas.has(f.chave));

    const preferida = normalizaPreferida(req.preferida);
    const fontePreferida = preferida ? saudaveis.find((f) => f.chave === preferida) : null;
    // Sem preferência explícita, nenhuma fonte elegível fica de fora da busca.
    // Uma preferência válida mantém a seleção focada e, se vier vazia, pode
    // acionar até duas alternativas.
    const onda = fontePreferida ? [fontePreferida] : saudaveis;

    // `resultados` indexado pela ORDEM de seleção (não de término): a resposta
    // lista as fontes consultadas na ordem em que entraram na onda.
    const resultados = [];
    const consultadas = [];
    const tarefas = [];

    function dispara(selecionadas) {
      for (const entrada of selecionadas) {
        const i = resultados.length;
        resultados.push(null);
        consultadas.push(entrada.chave);
        tarefas.push(executaTarefa(entrada, req).then((resultado) => { resultados[i] = resultado; }));
      }
    }

    // Espera todas as tarefas já disparadas ou o orçamento restante. Não há
    // retorno antecipado após o primeiro player: isso escondia resultados de
    // fontes mais lentas mesmo quando ainda cabiam no orçamento da consulta.
    // `espera` diz se TODAS terminaram — separa cache completo de parcial.
    async function espera() {
      if (!tarefas.length) return true;
      const todas = Promise.all(tarefas).then(() => true);
      let temporizador;
      const orcamento = new Promise((resolve) => {
        temporizador = setTimeout(() => resolve(false), restante());
      });
      const completas = await Promise.race([todas, orcamento]);
      clearTimeout(temporizador);
      return completas;
    }

    dispara(onda);
    let completas = await espera();
    let resposta = agruparStreams(resultados.map((r) => (r ? r.lista : null)));
    if (!resposta.length && fontePreferida) {
      // Na busca padrão todas as fontes elegíveis já foram consultadas; reserva
      // só existe quando o usuário pediu uma fonte específica e ela veio vazia.
      const reserva = saudaveis
        .filter((f) => f.chave !== fontePreferida.chave)
        .slice(0, MAX_RESERVA_PREFERIDA);
      if (reserva.length && completas && restante() > 0) {
        dispara(reserva);
        completas = (await espera()) && completas;
        resposta = agruparStreams(resultados.map((r) => (r ? r.lista : null)));
      }
    }

    // Regra da falha total: só houve resposta LIMPA se pelo menos uma fonte
    // consultada respondeu sem lançar/estourar timeout.
    const houveRespostaLimpa = resultados.some((r) => r && !r.errou);
    const vazia = resposta.length === 0;

    // O que entra no cache (spec §6): completo 5 min; parcial 15 s (a
    // regravação em background promove a 5 min); vazio só quando houve
    // resposta limpa — falha total nunca é guardada (spec §9).
    if (!vazia) {
      cache.guarda(chaveCache, { streams: resposta }, completas ? TTL_COMPLETO_MS : TTL_PARCIAL_MS);
    } else if (completas && houveRespostaLimpa) {
      cache.guarda(chaveCache, { streams: [] }, TTL_NEGATIVO_MS);
    }

    // Regravação em background (spec §5 passo 8): quando TODAS as tarefas
    // terminarem, o cache recebe o resultado completo — é o upgrade
    // PARCIAL → HIT da próxima chamada. Falha total continua sem gravar nada.
    Promise.all(tarefas).then(() => {
      const completo = agruparStreams(resultados.map((r) => (r ? r.lista : null)));
      const limpaAlguma = resultados.some((r) => r && !r.errou);
      if (completo.length) cache.guarda(chaveCache, { streams: completo }, TTL_COMPLETO_MS);
      else if (limpaAlguma) cache.guarda(chaveCache, { streams: [] }, TTL_NEGATIVO_MS);
    }).catch(() => {});                            // tarefas não rejeitam; guarda por via das dúvidas

    const rotulo = !vazia && !completas ? "parcial" : "miss";
    metricas.resolve(rotulo);
    const ms = agora() - inicio;
    metricas.resposta(ms);
    return { streams: resposta, fontes: consultadas, cache: rotulo.toUpperCase(), ms };
  }

  // Uma tarefa: `chamaFonte` com timeout próprio → qualificaLista com teto de
  // 5 s → marca `__mirrorSource` (é o que dirige `mediaWorkerDe` e
  // `bingeGroup` no agregador) → atualiza estado e métricas. Nunca rejeita:
  // erro da fonte vira lista vazia.
  async function executaTarefa(entrada, req) {
    const chave = entrada.chave;
    let bruta = null;
    let errou = false;
    try {
      const chamada = Promise.resolve().then(() => chama(chave, req));
      const limite = new Promise((_, rejeita) => {
        const id = setTimeout(() => rejeita(new Error(`timeout da fonte ${chave}`)), TIMEOUT_FONTE_MS);
        const cancela = () => clearTimeout(id);
        chamada.then(cancela, cancela);
      });
      bruta = await Promise.race([chamada, limite]);
    } catch (erro) {
      errou = true;                                // exceção ou timeout: falha da fonte
      // A MENSAGEM chega ao log. Sem isto o `beamup logs` só diz que a fonte
      // errou — nunca se é 403 do Cloudflare, timeout de 8 s ou corpo inválido,
      // e um operador não decide nada com "erro". O 403 do rtd no BeamUp ficou
      // invisível por causa desta linha que faltava. `console.error` (stderr) o
      // Dokku captura junto com o stdout. Não muda resposta nem métrica.
      const motivo = (erro && (erro.message || String(erro))) || "sem detalhe";
      console.error(`[fonte] ${chave}: ${motivo}`);
    }

    let lista = errou ? [] : (Array.isArray(bruta) ? bruta : []);
    if (!errou && lista.length) {
      try {
        let cancela = () => {};
        lista = await Promise.race([
          qualificaLista(lista),
          new Promise((resolve) => {
            const id = setTimeout(() => resolve(lista), TETO_QUALIFICA_MS);
            cancela = () => clearTimeout(id);
          }),
        ]).finally(cancela);
      } catch (_) { /* enriquecimento não pode derrubar a fonte que respondeu */ }
      if (!Array.isArray(lista)) lista = [];
    }

    if (errou) {
      estado.falha(chave);
      metricas.fonte(chave, "erro");
    } else {
      // Resposta limpa (mesmo vazia) zera as falhas: falha é rede/exceção/
      // timeout (spec §7), não "não tenho este título".
      estado.sucesso(chave);
      metricas.fonte(chave, lista.length ? "ok" : "vazio");
    }
    if (lista.length) {
      for (const stream of lista) {
        if (stream && typeof stream === "object") stream.__mirrorSource = chave;
      }
    }
    return { chave, lista, errou };
  }

  return resolve;
}

module.exports = { criaResolve };
