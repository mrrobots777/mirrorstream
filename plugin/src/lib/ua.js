const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"
];
const UA = UA_POOL[0];
const byHost = new Map();
function hashHost(host) {
  let h = 0;
  const s = String(host || "");
  for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i) >>> 0;
  return h;
}
function hostOf(url) {
  const m = String(url || "").match(/^https?:\/\/([^/:]+)/i);
  return (m ? m[1] : String(url || "")).toLowerCase();
}
function uaFor(url) {
  if (byHost.size > 500) byHost.clear();
  const host = hostOf(url);
  const hit = byHost.get(host);
  if (hit) return hit;
  const ua = UA_POOL[hashHost(host) % UA_POOL.length];
  byHost.set(host, ua);
  return ua;
}
module.exports = { UA, uaFor };
