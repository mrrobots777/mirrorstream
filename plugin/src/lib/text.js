function stripDiacritics(str) {
  return String(str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function lower(str) {
  return stripDiacritics(str).toLowerCase();
}
function normalizeLoose(str) {
  return lower(str).replace(/\s+/g, " ").trim();
}
function stripYear(name) {
  return String(name || "").replace(/\s*\(\d{4}\)\s*$/, "").trim();
}
function stripYearLoose(name) {
  return String(name || "").replace(/\s*\(\s*(?:19|20)\d{2}\s*\)\s*$/, " ").replace(/\s+(?:19|20)\d{2}\s*$/, " ").replace(/\s+/g, " ").trim();
}
function canonico(str) {
  return lower(str).replace(/(\w)['`´]s\b/g, "$1").replace(/[''`´]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function canonicoCompactado(str) {
  return canonico(str).replace(/\s+/g, "");
}
function ascii(str) {
  return lower(str);
}
function words(str) {
  return ascii(str).match(/[a-z0-9]+/g) || [];
}
function slugify(str) {
  return ascii(str).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function decodeEntities(str) {
  return String(str || "").replace(/&#0?38;|&amp;/g, "&").replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/&#8230;|&hellip;/g, "...").replace(/&#8211;|&ndash;/g, "-").replace(/&#8212;|&mdash;/g, "-").replace(/&nbsp;|&#160;/g, " ").replace(/&[a-z]+;/gi, "");
}
function looseMatch(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4));
}
function looseCoverage(texto, query, stopWords) {
  const qs = words(query);
  if (!qs.length) return 0;
  const tw = words(texto);
  let hit = 0;
  for (const w of qs) {
    if (w.length < 3 || stopWords && stopWords.has(w) || tw.includes(w) || tw.some((x) => looseMatch(x, w))) hit += 1;
  }
  return hit / qs.length;
}
function extraWords(texto, query, stopWords) {
  const q = ascii(query).trim();
  const qw = words(q);
  let extras = 0;
  for (const w of words(texto)) {
    if (q.includes(w) || w.length < 3) continue;
    if (stopWords && stopWords.has(w)) continue;
    if (qw.some((x) => looseMatch(x, w))) continue;
    extras += 1;
  }
  return extras;
}
module.exports = { stripDiacritics, lower, normalizeLoose, stripYear, stripYearLoose, canonico, canonicoCompactado, ascii, words, slugify, decodeEntities, looseCoverage, extraWords };
