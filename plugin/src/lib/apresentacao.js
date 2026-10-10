// CONTRATO DE APRESENTACAO — o objeto que o Nuvio mostra na lista de streams.
//
// MEDIDO no proprio app (`StreamRepositoryImpl.toPluginStream` e
// `Stream.getDisplayDescription`, em `/tmp/nuviotv/app/src/main/java/...`):
//
//   linha 1 = `name`, e o app ACRESCENTA " - <quality>" quando o texto ainda nao
//             contem a qualidade. Quando `quality` vem vazio, o app escreve o
//             rotulo de localizacao `stream_quality_unknown` — "Desconhecido" em
//             pt-BR. Por isso `quality` e sempre enviado quando existe dado real.
//   linha 2 = `description ?: title`. `description` so existe se o scraper mandar
//             `size` ou `language` (o app monta "size • language"). Como o plugin
//             nao manda nenhum dos dois, a linha 2 e o `title` — e por isso que o
//             `title` e o campo que importa, e nao `language`.
//   badge   = `addonName`, que vem do `name` do MANIFESTO (sigla), com `maxLines = 1`.
//
// Por isso o contrato e: linha 1 = o QUE E (a fonte monta o titulo canonico e o
// app acrescenta a qualidade), linha 2 = o resto em cascata, ending na sigla. A
// sigla vai no fim do `title` alem do badge porque o app tem a opcao "agrupar por
// repositorio" (uma tela so, todas as 15 viram "Mirror"); com a sigla no `title` a
// origem continua visivel mesmo com essa opcao ligada.
//
// REGRA QUE NAO SE NEGOCIA: a qualidade aqui e sempre a REAL, lida do video ou
// escrita pela origem. `naoHa()` nao inventa "720p" para uma linha parecer bonita —
// o projeto ja tem essa regra (`video-probe.js`, decisao 36) e ela vale igual aqui.
//
// A sigla vem do parametro `sigla`, nao do registro: `src/core/fontes/` e
// tooling-only (nao entra em nenhum bundle). O vinculo entre as duas coisas e
// travado por teste em `test/nuvio-apresentacao.test.js`.

const SEPARADOR = " · ";

function texto(valor) {
  return String(valor == null ? "" : valor).replace(/\s+/g, " ").trim();
}

function rotuloEpisodio(temporada, episodio) {
  const t = Number(temporada);
  const e = Number(episodio);
  if (!Number.isFinite(t) || !Number.isFinite(e) || t < 1 || e < 1) return "";
  return `S${String(t).padStart(2, "0")}E${String(e).padStart(2, "0")}`;
}

// O titulo que abre a linha 1. O ano e o do catalogo ou o do metadado; entra entre
// parenteses porque e assim que o olho le ("Matrix (1999)").
function linhaPrincipal(titulo, ano) {
  const base = texto(titulo);
  if (!base) return "";
  const y = Number(ano);
  if (!Number.isFinite(y) || y < 1870 || y > 2200) return base;
  return `${base} (${y})`;
}

/**
 * Monta o objeto de stream no contrato do app.
 *
 * @param {object} o
 * @param {string} o.sigla       sigla da fonte ("BLZ") — vem do proprio scraper
 * @param {string} o.url         url do video (obrigatorio)
 * @param {string} [o.titulo]    titulo canonico do conteudo ("Matrix")
 * @param {number} [o.ano]       ano, quando conhecido
 * @param {string} [o.qualidade] resolucao real ("1080p"); ausente = nao se sabe
 * @param {string} [o.idioma]    "Dublado" / "Legendado"
 * @param {number} [o.temporada]
 * @param {number} [o.episodio]
 * @param {string} [o.detalhe]   linha extra (o que esta no ar, por exemplo)
 * @param {string} [o.size]
 * @param {object} [o.headers]   cabeçalhos que o player precisa mandar
 * @param {Array}  [o.subtitles]
 */
function apresenta(o) {
  const opcoes = o || {};
  const sigla = texto(opcoes.sigla).toUpperCase();
  const url = texto(opcoes.url);
  if (!sigla) throw new Error("apresenta(): a fonte nao passou a sigla");
  if (!url) throw new Error(`apresenta(${sigla}): a fonte nao passou a url`);
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`apresenta(${sigla}): url nao e http(s) — ${url.slice(0, 60)}`);
  }

  const qualidade = texto(opcoes.qualidade) || "";

  const titulo = linhaPrincipal(opcoes.titulo, opcoes.ano);

  // Linha 1: o que e. Sem a fonte e sem a qualidade — o app cuida da qualidade, e a
  // fonte fica no badge e no fim da linha 2.
  const nome = titulo || sigla;

  // Linha 2: o resto, uma informacao por peca, na ordem em que o olho le.
  const pecas = [
    texto(opcoes.idioma),
    rotuloEpisodio(opcoes.temporada, opcoes.episodio),
    texto(opcoes.detalhe),
    texto(opcoes.size),
    sigla
  ];
  const linha2 = pecas.filter(Boolean).join(SEPARADOR);

  const saida = { name: nome, title: linha2, url };
  if (qualidade) saida.quality = qualidade;
  if (opcoes.headers && Object.keys(opcoes.headers).length) saida.headers = opcoes.headers;
  if (Array.isArray(opcoes.subtitles) && opcoes.subtitles.length) {
    saida.subtitles = opcoes.subtitles;
  }
  return saida;
}

module.exports = {
  SEPARADOR,
  apresenta,
  rotuloEpisodio
};
