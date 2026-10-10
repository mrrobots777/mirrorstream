const { normalizeQuality, qualityRank } = require("./quality");
const { extractQuality } = require("./quality");
const { mediaWorkerDe } = require("../core/politica");

// O Nuvio exibe cada scraper do manifesto como um provedor separado. O agregador
// transforma as respostas das fontes internas em uma única lista do MirrorStream:
// no máximo um link por qualidade, escolhendo o primeiro link válido encontrado.
function qualidadeDe(stream) {
  if (!stream) return "unknown";
  return normalizeQuality(stream.quality)
    || extractQuality(stream.name)
    || extractQuality(stream.title)
    || extractQuality(stream.url)
    || "unknown";
}

function tipoDe(stream) {
  const texto = [stream && stream.language, stream && stream.idioma, stream && stream.title, stream && stream.name]
    .filter(Boolean).join(" ").toLowerCase();
  if (/dublad/.test(texto)) return "dublado";
  if (/legendad|\bleg\b|subtit/.test(texto)) return "legendado";
  return "unknown";
}

function rotuloIdioma(tipo) {
  if (tipo === "dublado") return "Dublado";
  if (tipo === "legendado") return "Legendado";
  return "Idioma não informado";
}

function agruparStreams(listas) {
  const porQualidade = new Map();
  for (const lista of listas || []) {
    if (!Array.isArray(lista)) continue;
    for (const bruto of lista) {
      if (!bruto || typeof bruto.url !== "string" || !bruto.url.trim()) continue;
      const qualidade = qualidadeDe(bruto);
      const tipo = tipoDe(bruto);
      // A unidade do Nuvio é uma combinação de resolução e tipo de áudio. Assim,
      // 1080p Dublado e 1080p Legendado continuam sendo duas opções corretas.
      // Quando a origem não informa um dos dois, usamos a URL como desempate para
      // não esconder players válidos nem inventar metadados.
      const chave = qualidade !== "unknown" && tipo !== "unknown"
        ? `${qualidade}:${tipo}`
        : qualidade !== "unknown"
          ? `${qualidade}:unknown`
          : tipo !== "unknown"
            ? `unknown:${tipo}`
            : `unknown:unknown:${bruto.url}`;
      if (porQualidade.has(chave)) continue;
      const stream = { ...bruto };
      if (qualidade !== "unknown") stream.quality = qualidade;
      // O Nuvio usa `title` como a segunda linha visível. Algumas fontes preenchem
      // `language`/`idioma`, mas não o texto; outras não têm esse dado no catálogo.
      // Normalize no ponto único para nunca exibir um player sem indicação de áudio
      // e não invente Dublado/Legendado quando a origem não permite distinguir.
      const idioma = rotuloIdioma(tipo);
      const tituloVisivel = String(stream.title || "").trim();
      if (!/(?:dublad|legendad|idioma\s+n[aã]o\s+informado)/i.test(tituloVisivel)) {
        stream.title = [tituloVisivel, idioma].filter(Boolean).join(" · ");
      }
      const fonte = typeof bruto.__mirrorSource === "string" ? bruto.__mirrorSource : "";
      if (fonte) {
        const edgeUrl = mediaWorkerDe(stream.url, fonte, stream.referer || stream.referrer);
        if (edgeUrl) stream.url = edgeUrl;
        stream.behaviorHints = {
          ...(stream.behaviorHints && typeof stream.behaviorHints === "object" ? stream.behaviorHints : {}),
          bingeGroup: `mirrorstream:${fonte}`
        };
        delete stream.__mirrorSource;
      }
      // Algumas versões do Nuvio exibem somente `name` e ignoram `title`/`quality`.
      // Repetimos os metadados no nome para manter a informação visível em todos os
      // clientes, sem remover os campos estruturados usados pelas versões novas.
      const qualidadeVisivel = qualidade === "unknown" ? "Qualidade não informada" : qualidade;
      stream.name = `☁️ MirrorStream · ${qualidadeVisivel} · ${idioma}`;
      stream.provider = "☁️ MirrorStream";
      porQualidade.set(chave, stream);
    }
  }
  return [...porQualidade.entries()]
    .sort(([a], [b]) => qualityRank(String(a).split(":", 1)[0]) - qualityRank(String(b).split(":", 1)[0]))
    .map(([, stream]) => stream);
}

module.exports = { agruparStreams };
