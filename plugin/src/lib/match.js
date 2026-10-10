const { lower, normalizeLoose, stripYear, stripYearLoose, canonico, canonicoCompactado } = require("./text");
function matchKey(str) {
  return lower(str).replace(/[-:.]/g, " ").replace(/\s+/g, " ").trim();
}
function stripArticles(str) {
  return String(str || "").replace(/^(the|a|an|o|as|um|uma)\s+/i, "");
}
function extractYear(name, query) {
  const qDigits = new Set(String(query || "").match(/\b(?:19|20)\d{2}\b/g) || []);
  const maxYear = ( new Date()).getFullYear() + 1;
  const valid = (s) => {
    const n = Number(s);
    return n >= 1900 && n <= maxYear;
  };
  const text = String(name || "");
  const paren = text.match(/\(((?:19|20)\d{2})\)/);
  if (paren && !qDigits.has(paren[1]) && valid(paren[1])) return Number(paren[1]);
  const all = text.match(/\b(?:19|20)\d{2}\b/g) || [];
  for (let i = all.length - 1; i >= 0; i--) {
    if (!qDigits.has(all[i]) && valid(all[i])) return Number(all[i]);
  }
  return null;
}
function adjustScoreForYear(score, name, query, year) {
  const y = Number(year) || 0;
  if (!y || score < 60) return score;
  const ny = extractYear(name, query);
  if (!ny) return score;
  if (ny === y) return Math.min(100, score + 5);
  return Math.min(score, 50);
}
function scorePair(q, n) {
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) {
    const rawRest = n.slice(q.length).trim();
    let rest = rawRest.replace(/^[:\-–|•·.\s]+/, "");
    rest = rest.replace(/^\[[^\]]*\]\s*/i, "").replace(/^[:\-–|•·.\s]+/, "").trim();
    if (!rest || /^\(?(?:19|20)\d{2}\)?\s*$/i.test(rest) || /^\d+k\s*$/i.test(rest) || /^\(?(?:19|20)\d{2}\)?\s+\d+k\s*$/i.test(rest) || /^\d+k\s+\(?(?:19|20)\d{2}\)?\s*$/i.test(rest) || /^[-–|\s]*(?:fhd|full\s*hd|hd|sd|4k|1080p|720p|480p|2160p|uhd)\s*$/i.test(rest) || /^s\d+/i.test(rest)) return 90;
    if (/^[:\-–|]/.test(rawRest)) return 85;
    if (/\s/.test(rest)) return 85;
    return 60;
  }
  if (n.includes(q)) return 80;
  if (q.includes(n) && n.length > 3) {
    const i = q.indexOf(n);
    const sobra = (q.slice(0, i) + " " + q.slice(i + n.length)).replace(/\s+/g, " ").trim();
    if (/^\(?(?:19|20)\d{2}\)?(\s+\(?(?:19|20)\d{2}\)?)?$/.test(sobra) || /^\d+k$/.test(sobra) || /^s\d+/i.test(sobra) || /^(?:fhd|full hd|hd|sd|4k|1080p|720p|480p|2160p|uhd)$/.test(sobra)) return 90;
    return 60;
  }
  const qWords = q.split(/\s+/).filter(Boolean);
  const nWords = n.split(/\s+/).filter(Boolean);
  if (!qWords.length || !nWords.length) return 0;
  let matches = 0;
  for (const w of qWords) {
    if (nWords.some((nw) => palavraForte(w) && nw.includes(w) || palavraForte(nw) && w.includes(nw))) matches++;
  }
  if (matches > 0 && matches >= qWords.length * 0.5) return 50 + matches * 5;
  return 0;
}
function matchScore(query, name) {
  const q = matchKey(query);
  const n = matchKey(name);
  if (!q || !n) return 0;
  let s = scorePair(q, n);
  const qa = matchKey(stripArticles(q));
  const na = matchKey(stripArticles(n));
  if (qa !== q || na !== n) s = Math.max(s, scorePair(qa, na));
  const qn = q.replace(/\s+/g, "");
  const nn = n.replace(/\s+/g, "");
  if (qn !== q || nn !== n) {
    s = Math.max(s, scorePair(qn, nn), scorePair(qa.replace(/\s+/g, ""), na.replace(/\s+/g, "")));
  }
  return s;
}
function titleCompare(c, q, isSeries) {
  if (c === q) return true;
  const cBase = c.replace(/\s*\(\d{4}\)/g, " ").replace(/\b(4k|uhd|fhd|full hd|hd|sd|1080p|720p|480p|2160p)\b/g, " ").replace(/\s+/g, " ").trim();
  const qBase = q.replace(/\s*\(\d{4}\)/g, " ").replace(/\s+/g, " ").trim();
  if (cBase === qBase || cBase === q) return true;
  if (c.startsWith(q)) {
    const rest = c.slice(q.length).trim();
    if (!rest) return true;
    if (/^\(?\d{4}\)?/.test(rest)) return true;
    if (/^\[[^\]]*\]/.test(rest)) {
      const after = rest.replace(/^\[[^\]]*\]\s*/, "").trim();
      if (!after || /^\(?\d{4}\)?/.test(after) || /^[:\-–|(]/.test(after) || isSeries && /^s\d+/i.test(after) || /^(4k|uhd|fhd|full hd|hd|sd|1080p|720p|480p|2160p)\b/i.test(after)) return true;
    }
    if (/^(4k|uhd|fhd|full hd|hd|sd|1080p|720p|480p|2160p)\b/i.test(rest)) return true;
    if (isSeries && /^[:\-–|(]/.test(rest)) return true;
    if (isSeries && /^s\d+/i.test(rest)) return true;
    // Catálogos de anime frequentemente publicam a continuação como
    // "Título II/III/IV", enquanto o TMDB/Cinemeta envia apenas "Título".
    // O sufixo romano é uma variante de temporada, não outro título.
    if (isSeries && /^(?:(?:II|III|IV|V|VI|VII|VIII|IX|X)|s\d{1,2}|(?:season|temporada|part|parte|cour)\s*\d{1,2}|\d{1,2})(?:\s*[:\-–|].*)?$/i.test(rest)) return true;
  }
  return false;
}
const TITLE_QUALIFIERS = /\b(cl[aá]ssico|classic|remaster(?:izado)?|remastered|hd|fhd|full\s?hd|4k|uhd|3d|2d|dublado|dublada|legendado|legendada|completo|completa|intacto|original|remasterizacao)\b/gi;
function stripTitleQualifiers(s) {
  return String(s || "").replace(TITLE_QUALIFIERS, " ").replace(/\s{2,}/g, " ").trim();
}
function matchVodTitle(name, query, isSeries, year) {
  const rawName = String(name || "");
  const rawQuery = String(query || "");
  const c = normalizeLoose(name);
  const q = normalizeLoose(query);
  if (!c || !q) return false;
  if (year) {
    const ny = extractYear(rawName, rawQuery);
    if (ny && Number(year) !== ny) return false;
  }
  const cVars = [... new Set([c, stripArticles(c), normalizeLoose(stripTitleQualifiers(rawName))])];
  const qVars = [... new Set([q, stripArticles(q), normalizeLoose(stripTitleQualifiers(rawQuery)), ...(isSeries && q.includes(":") ? [q.split(":", 1)[0].trim()] : [])])];
  for (const cv of cVars) {
    for (const qv of qVars) {
      if (titleCompare(cv, qv, isSeries)) return true;
    }
  }
  const cTodos = [... new Set([rawName, c, normalizeLoose(stripTitleQualifiers(rawName))])];
  const qTodos = [... new Set([rawQuery, q, normalizeLoose(stripTitleQualifiers(rawQuery))])];
  for (const cv of cTodos) {
    for (const qv of qTodos) {
      const ck = canonico(stripYearLoose(cv));
      const qk = canonico(stripYearLoose(qv));
      if (!ck || !qk) continue;
      if (ck === qk) return true;
      if (canonicoCompactado(stripYearLoose(cv)) === canonicoCompactado(stripYearLoose(qv))) return true;
      if (ck.startsWith(qk) || qk.startsWith(ck)) {
        const maior = ck.length >= qk.length ? ck : qk;
        const menor = ck.length >= qk.length ? qk : ck;
        const resto = maior.slice(menor.length).trim();
        if (!resto || /^(?:19|20)\d{2}$/.test(resto) || /^(?:19|20)\d{2}\s+(?:19|20)\d{2}$/.test(resto)) return true;
        if (isSeries && (/^s\d+/i.test(resto) || /^(?:ii|iii|iv|v|vi|vii|viii|ix|x)$/i.test(resto) || /^(?:season|temporada|part|parte|cour)\s*\d{1,2}$/i.test(resto) || /^\d{1,2}$/.test(resto))) return true;
      }
    }
  }
  return false;
}
function palavraForte(w) {
  return w.length >= 4;
}
function preFiltra(itens, query) {
  const chave = matchKey(query);
  if (!chave) return itens;
  const palavras = chave.split(" ").filter(palavraForte);
  if (!palavras.length) return itens;
  return itens.filter((item) => {
    const k = item.key || matchKey(item.name || "");
    if (!k) return false;
    if (k.includes(chave) || chave.includes(k)) return true;
    for (const p of palavras) if (k.includes(p)) return true;
    return false;
  });
}
const PEN_SHIPPUDEN_PADRAO = { re: /\bshippu?den\b/i, penalty: 30 };
const PEN_SHIPPUDEN_ALT = { re: /\bshippu?uden\b/i, penalty: 30 };
const PEN_BORUTO = { re: /\bboruto\b/i, penalty: 15 };
const PEN_FINAL_SEASON = { re: /\bfinal season\b|\bthe last season\b/i, penalty: 15 };
const PEN_CLASSICO = { re: /\bcl[aá]ssico\b|\bclassic\b|\bhd remaster\b/i, penalty: 5 };
const PEN_FILME = {
  re: /\bmovie\b|\bfilme\b|\bcinema\b|\bspecial\b|\bespecial\b|\bthe last\b|\bblood prison\b|\broads to ninja\b|\bhi no ishi\b|\bkizuna\b|\bdai koufun\b|\bmikazuki\b/i,
  penalty: 20
};
const PEN_HEN = { re: /-hen\b/i, penalty: 25 };
const TEMPORADA_RE = /\b(?:temporada|season|parte|part|cour)\s*(\d{1,2})\b|\bs(\d{1,2})\b|(?:^|[\s:–-])((?:ii|iii|iv|v|vi|vii|viii|ix|x))(?=\b|\s*[:–-])|(?:^|[\s:–-])(\d{1,2})$/i;
const ROMANO_TEMPORADA = Object.freeze({ ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 });
function numeroDaTemporada(titulo) {
  const m = String(titulo || "").match(TEMPORADA_RE);
  if (!m) return null;
  if (m[1] || m[2] || m[4]) return Number(m[1] || m[2] || m[4]);
  return ROMANO_TEMPORADA[String(m[3] || "").toLowerCase()] || null;
}
function penalidadeQuandoAusenteNaConsulta(titulo, consulta, regras) {
  let total = 0;
  for (const regra of regras) {
    if (!regra || !regra.re.test(titulo)) continue;
    if (regra.sempre !== true && consulta && regra.re.test(consulta)) continue;
    total -= regra.penalty;
  }
  return total;
}
function penalidadeSempre(titulo, regras) {
  let total = 0;
  for (const regra of regras) {
    if (regra && regra.re.test(titulo)) total -= regra.penalty;
  }
  return total;
}
function bonusTemporada(titulo, season, opts) {
  const n = numeroDaTemporada(titulo);
  if (!n) return 0;
  const config = opts || {};
  const certo = config.acerta === void 0 ? 15 : config.acerta;
  const errado = config.errada === void 0 ? -30 : config.errada;
  return n === (Number(season) || 1) ? certo : errado;
}
function bonusNumeroFinal(titulo, consulta, season, opts) {
  const config = opts || {};
  let base = String(titulo || "");
  if (config.removeEpisodio !== false) {
    base = base.replace(/\s*[-–|•·]?\s*epis[óo]dio\s*\d+.*$/i, "");
  }
  const tail = base.match(/(?:^|\s)(\d{1,2})(?=\s|$)/g);
  if (!tail || !tail.length) return 0;
  const n = Number(tail[tail.length - 1].trim());
  if (queryHit(consulta, n)) return 0;
  const certo = config.acerta === void 0 ? 15 : config.acerta;
  const errado = config.errada === void 0 ? -30 : config.errada;
  return n === (Number(season) || 1) ? certo : errado;
}
function queryHit(consulta, n) {
  if (!consulta) return false;
  return new RegExp(`(?:^|\\s)${n}(?=\\s|$)`).test(consulta);
}
function bestMatchScore(query, names) {
  let best = 0;
  for (const name of names || []) {
    const s = Math.max(matchScore(query, name), matchScore(query, stripYear(name)));
    if (s > best) best = s;
  }
  return best;
}
module.exports = { matchKey, matchScore, matchVodTitle, preFiltra, bestMatchScore, adjustScoreForYear, extractYear, penalidadeQuandoAusenteNaConsulta, penalidadeSempre, numeroDaTemporada, bonusTemporada, bonusNumeroFinal, PEN_SHIPPUDEN_PADRAO, PEN_SHIPPUDEN_ALT, PEN_BORUTO, PEN_FINAL_SEASON, PEN_CLASSICO, PEN_FILME, PEN_HEN };
