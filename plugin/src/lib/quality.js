const QUALITY_MAP = { "2160p": 4, "1440p": 3.5, "1080p": 3, "720p": 2, "480p": 1, "360p": 0.5 };
const QUALITY_RANK = { "2160p": 0, "2160": 0, "4k": 0, "fhd": 1, "1080p": 1, "1080": 1, "hd": 2, "720p": 2, "720": 2, "sd": 3, "480p": 3, "480": 3, "360p": 4, "360": 4 };
function normalizeQuality(q) {
  if (!q) return null;
  const s = q.toLowerCase().trim();
  if (s === "4k" || s === "2160p" || s === "2160" || s === "uhd") return "2160p";
  if (s === "fhd" || s === "full hd" || s === "1080p" || s === "1080") return "1080p";
  if (s === "hd" || s === "720p" || s === "720") return "720p";
  if (s === "sd" || s === "480p" || s === "480") return "480p";
  if (s === "360p" || s === "360") return "360p";
  if (/^p?\d{3,4}$/.test(s)) {
    const n = parseInt(s.replace("p", ""), 10);
    if (n >= 2e3) return "2160p";
    if (n >= 900) return "1080p";
    if (n >= 600) return "720p";
    return "480p";
  }
  return null;
}
function extractQuality(name) {
  const match = String(name || "").match(/\b(4K|2160p?|FHD|FULL\s*HD|1080p?|HD|720p?|480p?|360p?|SD|UHD)\b/i);
  if (!match) return null;
  return normalizeQuality(match[1]);
}
function stripQuality(name) {
  return String(name || "").replace(/\s*\[?(4K|2160p?|FHD|FULL\s*HD|1080p?|HD|720p?|480p?|360p?|SD|UHD)\]?\s*/gi, "").replace(/\s*\[.*?\]\s*/g, " ").replace(/\s*[-–]\s*$/, "").replace(/\s+/g, " ").trim();
}
function qualityScore(quality) {
  return QUALITY_MAP[quality] || 0;
}
function qualityRank(quality) {
  return QUALITY_RANK[String(quality || "").toLowerCase()] ?? 5;
}
function resolutionToQuality(width, height) {
  const h = Math.max(width || 0, height || 0);
  if (h >= 2e3) return "2160p";
  if (h >= 900) return "1080p";
  if (h >= 600) return "720p";
  if (h >= 400) return "480p";
  return null;
}
function videoResolutionToQuality(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return null;
  if (w >= 3400 || h >= 1900) return "2160p";
  if (w >= 1800) return "1080p";
  if (w >= 1100) return "720p";
  if (w >= 620) return "480p";
  if (w >= 400) return "360p";
  return null;
}
module.exports = { QUALITY_MAP, normalizeQuality, extractQuality, stripQuality, qualityScore, qualityRank, resolutionToQuality, videoResolutionToQuality };
