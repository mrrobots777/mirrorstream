const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");
const JavaScriptObfuscator = require("javascript-obfuscator");

const fontes = require("./src/core/fontes");
const { TETO_CORPO_BYTES, TETO_CORPO_LIMITED_BYTES } = require("./src/core/sandbox");

const raiz = __dirname;

function arquivoDe(chave) {
  return path.join(raiz, fontes.caminhoDe(chave));
}

// A CHAVE DO TMDB NO BUNDLE.
//
// MEDIDO 02/10/2026: rodando os 11 bundles de `public/` em Node, 10 deles LANCAM
// `TMDB_API_KEY ausente`. O `CONTRATO.md` diz que a global e' "injetada" pelo app — e nenhum
// codigo do repositorio a define em tempo de runtime: so as ferramentas Node o fazem, para
// conseguir medir. Sem a chave no aparelho, as fontes que precisam do titulo devolvem `[]`
// sem erro, que e' o mesmo defeito que acabamos de corrigir voltando por outra porta.
//
// DE ONDE VEM A CHAVE: `plugin/config/tmdb.js` é a configuração versionada do plugin. Injetar
// no bundle é necessário porque o Nuvio não fornece variáveis de ambiente ao scraper no aparelho.
// O build também aceita TMDB_API_KEY no ambiente, útil para trocar a chave sem editar o arquivo.
//
// Se a leitura falhar (repo montado sem o monorepo, ou o padrao mudar), o build AVISA e segue
// sem injetar — com a mesma consequencia de antes, e nao com um build quebrado.
function chaveTmdb() {
  const env = process.env.TMDB_API_KEY;
  if (env && String(env).trim()) return String(env).trim();
  const fontes = [path.join(raiz, "config", "tmdb.js")];
  const padroes = [
    /TMDB_API_KEY\s*\|\|\s*["']([0-9a-fA-F]{20,})["']/,
    /TMDB_API_KEY\s*[:=]\s*["']([0-9a-zA-Z_-]{20,})["']/,
    /TMDB_KEY[^\n]*["']([0-9a-zA-Z_-]{20,})["']/,
  ];
  for (const arquivo of fontes) {
    try {
      const txt = fs.readFileSync(arquivo, "utf8");
      for (const p of padroes) {
        const m = txt.match(p);
        if (m) return m[1];
      }
    } catch (_) {
      /* sem esse arquivo */
    }
  }
  return null;
}

function confereRegistro() {
  const erros = [];
  for (const chave of fontes.chaves()) {
    const f = fontes.FONTES[chave];
    const arquivo = arquivoDe(chave);
    if (!fs.existsSync(arquivo)) erros.push(`fonte ${chave} sem ${fontes.caminhoDe(chave)}`);
    if (!f.sigla || f.sigla !== chave.toUpperCase()) erros.push(`fonte ${chave}: sigla "${f.sigla}" deveria ser ${chave.toUpperCase()}`);
    if (!f.conteudos || !f.conteudos.length) erros.push(`fonte ${chave} sem conteudos`);
    for (const c of f.conteudos) {
      if (!fontes.CONTEUDOS.includes(c)) erros.push(`fonte ${chave}: conteudo "${c}" fora de CONTEUDOS`);
    }
    for (const t of f.tipos) {
      if (!["movie", "tv", "channel"].includes(t)) erros.push(`fonte ${chave}: tipo "${t}" fora de movie|tv|channel`);
    }
    if (f.tipos.includes("channel") && f.conteudos.length !== 1) erros.push(`fonte ${chave}: so "channel" pode servir mais de um conteudo`);
    if (!f.tipos.includes("channel") && f.conteudos.includes("tv")) erros.push(`fonte ${chave}: conteudo tv exige tipos ["channel"]`);
    if (!f.descricao) erros.push(`fonte ${chave} sem descricao (o dono le isso na tela de Plugins)`);
  }
  // Varredura RECURSIVA: os scrapers vivem em `src/scrapers/<categoria>/`, e um
  // arquivo plano aqui marcaria todo subdiretorio como "fora do registro". Os
  // caminhos sao relativos a `plugin/` com separador `/` — o formato de `caminhoDe`.
  const dir = path.join(raiz, "src", "scrapers");
  const declarados = new Set(fontes.chavesTodos().map(chave => fontes.caminhoDe(chave)));
  const varridos = [];
  const anda = (atual) => {
    for (const nome of fs.readdirSync(atual)) {
      const alvo = path.join(atual, nome);
      if (fs.statSync(alvo).isDirectory()) anda(alvo);
      else if (nome.endsWith(".js")) varridos.push(path.relative(raiz, alvo).split(path.sep).join("/"));
    }
  };
  if (fs.existsSync(dir)) anda(dir);
  const naoDeclarados = varridos.filter(caminho => !declarados.has(caminho));
  for (const caminho of naoDeclarados) {
    erros.push(`${caminho} nao esta no registro (src/core/fontes/) — some do dist`);
  }
  if (erros.length) throw new Error(erros.join("; "));
}

function confereManifesto(manifest) {
  const erros = [];
  if (!manifest.name) erros.push("manifest sem name");
  if (!manifest.version) erros.push("manifest sem version");
  if (!Array.isArray(manifest.scrapers) || !manifest.scrapers.length) erros.push("manifest sem scrapers");
  const esperado = fontes.manifesto().scrapers;
  if (JSON.stringify(manifest.scrapers) !== JSON.stringify(esperado)) {
    erros.push("manifesto nao coincide com o scraper agregado do registro");
  }
  for (const scraper of manifest.scrapers || []) {
    for (const campo of ["id", "name", "version", "filename", "description"]) {
      if (!scraper[campo]) erros.push(`scraper ${scraper.id || "?"} sem ${campo}`);
    }
    if (!Array.isArray(scraper.supportedTypes) || !scraper.supportedTypes.length) {
      erros.push(`scraper ${scraper.id}: supportedTypes vazio`);
    }
    if (scraper.id && scraper.filename && scraper.filename !== `${scraper.id}.js`) {
      erros.push(`scraper ${scraper.id}: filename "${scraper.filename}" difere de ${scraper.id}.js`);
    }
  }
  if (erros.length) throw new Error(erros.join("; "));
  return manifest;
}

function apagaFora(diretorio, nomes) {
  if (!fs.existsSync(diretorio)) return [];
  const removidos = [];
  for (const nome of fs.readdirSync(diretorio)) {
    if (nomes.includes(nome)) continue;
    const alvo = path.join(diretorio, nome);
    if (fs.statSync(alvo).isDirectory()) continue;
    fs.unlinkSync(alvo);
    removidos.push(nome);
  }
  return removidos;
}

function tetoDoIndice() {
  const indice = path.join(raiz, "public", "idx", "indice.json");
  if (!fs.existsSync(indice)) return null;
  try {
    const dados = JSON.parse(fs.readFileSync(indice, "utf8"));
    let maior = { chave: "-", bytes: 0 };
    for (const fonte of Object.keys(dados.fontes || {})) {
      const shard = dados.fontes[fonte].maiorShard || { chave: "?", bytes: 0 };
      if (shard.bytes > maior.bytes) maior = { chave: `${fonte}/${shard.chave}`, bytes: shard.bytes };
    }
    return { ...maior, total: Number(dados.totalItens) || 0 };
  } catch (_) {
    return null;
  }
}

// O código que o Nuvio executa sempre pode ser extraído do aparelho. A ofuscação não é
// sigilo criptográfico, mas reduz leitura casual e não expõe sourcemap. Só o bundle público
// agregado passa por esta etapa; os bundles internos continuam legíveis no workspace de build.
function ofuscaBundlePublico(arquivo) {
  const original = fs.readFileSync(arquivo, "utf8");
  const resultado = JavaScriptObfuscator.obfuscate(original, {
    compact: true,
    simplify: true,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 1,
    rotateStringArray: true,
    selfDefending: false,
    debugProtection: false,
    disableConsoleOutput: false,
    sourceMap: false,
    unicodeEscapeSequence: true,
  });
  fs.writeFileSync(arquivo, `${resultado.getObfuscatedCode()}\n`);
  return { antes: Buffer.byteLength(original), depois: fs.statSync(arquivo).size };
}

// Cada scraper entra no bundle por um embrulho GERADO aqui, e nao pelo arquivo de
// `src/scrapers/` direto. O embrulho e o que roda a fonte e depois completa a
// qualidade dos streams que sairam sem ela (`src/lib/qualifica.js`).
//
// Por que no build e nao em cada scraper: vale para todas as fontes, e "lembrar
// de chamar a
// qualifica" e exatamente o tipo de coisa que se esquece na 16a. Aqui nao ha como
// esquecer — a lista de entradas deste arquivo ja passa pelo embrulho.
function entradaDe(chave, tmdbKey) {
  // Relativo ao embrulho GERADO em `.build/<chave>.js`: `caminhoDe` ja' nasce
  // relativo a `plugin/`, entao so' sobe um nivel (`..`) ate' la.
  const base = path.join("..", fontes.caminhoDe(chave));
  const corpo = [
    // A global vai no EMBRULHO, e nao em cada fonte: e' o mesmo valor para todas, e um lugar
    // a menos para esquecer. E so entra quando a chave foi encontrada — um `globalThis.X =
    // undefined` sobrescreveria uma chave que o app tivesse injetado, que e' pior nao ter
    // nada (MEDIDO: e' assim que a chave do app seria apagada).
    tmdbKey ? `if (!globalThis.TMDB_API_KEY) globalThis.TMDB_API_KEY = ${JSON.stringify(tmdbKey)};` : "// sem chave do TMDB: o app tem de injetar (ver build.js::chaveTmdb)",
    'const base = require("' + base.replace(/\\/g, "/") + '");',
    'const { qualifica } = require("../src/lib/qualifica");',
    "module.exports = Object.assign({}, base, {",
    "  getStreams: (...args) => qualifica(base.getStreams, ...args)",
    "});"
  ].join("\n");
  const dir = path.join(raiz, ".build");
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, `${chave}.js`);
  fs.writeFileSync(arquivo, corpo);
  return arquivo;
}

function entradaAgregada(tmdbKey) {
  const imports = fontes.chaves().map((chave) => {
    const caminho = path.join("..", fontes.caminhoDe(chave)).replace(/\\/g, "/");
    const registro = fontes.fonte(chave);
    return `{ id: ${JSON.stringify(chave)}, tipos: ${JSON.stringify(registro.tipos || [])}, fn: require(${JSON.stringify(caminho)}) }`;
  }).join(",\n  ");
  const corpo = [
    tmdbKey ? `if (!globalThis.TMDB_API_KEY) globalThis.TMDB_API_KEY = ${JSON.stringify(tmdbKey)};` : "",
    `const fontes = [\n  ${imports}\n];`,
    'const { resolveBatchUrl } = require("../src/core/politica");',
    "function preferenciaDe(args) {",
    "  for (const valor of args.slice(4)) {",
    "    if (typeof valor === 'string' && /^mirrorstream:/i.test(valor)) return valor.trim().toLowerCase();",
    "    if (!valor || typeof valor !== 'object') continue;",
    "    const grupo = valor.preferredBingeGroup || valor.bingeGroup || valor.preferredSource || valor.source || valor.sourceId;",
    "    if (typeof grupo === 'string' && grupo.trim()) return grupo.trim().toLowerCase();",
    "  }",
    "  return '';",
    "}",
    "function idDaPreferencia(grupo) { return String(grupo || '').replace(/^mirrorstream:/i, '').trim().toLowerCase(); }",
    "async function getStreams(...args) {",
    "  const url = resolveBatchUrl(args, preferenciaDe(args));",
    "  if (!url || typeof fetch !== 'function') return [];",
    "  try {",
    "    const res = await Promise.race([",
    "      fetch(url, { headers: { Accept: 'application/json' } }),",
    "      new Promise((_, reject) => setTimeout(() => reject(new Error('gateway timeout')), 8000))",
    "    ]);",
    "    if (!res || !res.ok) return [];",
    "    const body = await res.json();",
    "    return Array.isArray(body.streams) ? body.streams : [];",
    "  } catch (_) { return []; }",
    "}",
    "module.exports = { getStreams };"
  ].join("\n");
  const dir = path.join(raiz, ".build");
  fs.mkdirSync(dir, { recursive: true });
  const arquivo = path.join(dir, "mirrorstream.js");
  fs.writeFileSync(arquivo, corpo);
  return arquivo;
}

async function main() {
  confereRegistro();
  const manifest = confereManifesto(fontes.manifesto());

  const tmdbKey = chaveTmdb();
  if (!tmdbKey) {
    console.warn(
      "[build] AVISO: nenhuma chave do TMDB encontrada em plugin/config/tmdb.js — os bundles vao sem " +
        "chave e, no aparelho, as fontes que precisam do titulo devolvem [] sem erro."
    );
  }

  const entradas = {};
  for (const chave of fontes.chaves()) entradas[chave] = entradaDe(chave, tmdbKey);
  entradas.mirrorstream = entradaAgregada(tmdbKey);

  const saida = path.join(raiz, "dist");
  fs.mkdirSync(saida, { recursive: true });

  await esbuild.build({
    entryPoints: entradas,
    outdir: saida,
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2020",
    minify: true,
    external: ["cheerio", "crypto-js"],
    logLevel: "warning",
  });

  const bundlePublico = path.join(saida, "mirrorstream.js");
  const tamanhoOfuscado = ofuscaBundlePublico(bundlePublico);

  const esperado = fontes.chaves().map(chave => `${chave}.js`).concat("mirrorstream.js", "manifest.json");
  const removidos = apagaFora(saida, esperado);
  const corpo = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(saida, "manifest.json"), corpo);
  fs.rmSync(path.join(raiz, ".build"), { recursive: true, force: true });

  // `public/` e a raiz que vai para o GitHub Pages: tem que servir o manifest, os
  // `<fonte>.js` E o `idx/` (indice estatico de blz/spc/ato) no mesmo endereco, porque o
  // provider monta a URL do shard a partir da MESMA base do manifest. `idx/` e
  // gerado pelo `tools/publicacao/gerar-indice.js` e nunca e apagado aqui.
  const gerados = ["mirrorstream.js"];
  const publica = path.join(raiz, "public");
  if (fs.existsSync(publica)) {
    // `index.html` e `.nojekyll` sao gerados AQUI, e nao versionados em `public/`, porque
    // `apagaFora` abaixo apaga qualquer arquivo que nao seja bundle ou indice. MEDIDO
    // 08/10/2026: a raiz `https://mrrobots777.github.io/mirrorstream/` respondia 404
    // enquanto o `manifest.json` respondia 200 — o app pede a raiz do repositorio de
    // plugins, e sem `index.html` ele recebia 404 mesmo com o manifesto publicado. O
    // `.nojekyll` impede o GitHub de reescrever `manifest.json` num wrapper HTML, que e'
    // o que quebra o parse do app sem erro visivel.
    const KEEP_PUBLICA = ["PLANO-PUBLICACAO.md", "index.html", ".nojekyll", "logo.png", "mirrorstream.js", "manifest.json"];
    const removidosPublica = apagaFora(publica, KEEP_PUBLICA);
    for (const nome of ["mirrorstream.js", "manifest.json"]) fs.copyFileSync(path.join(saida, nome), path.join(publica, nome));
    fs.writeFileSync(path.join(publica, ".nojekyll"), "");
    fs.copyFileSync(path.join(raiz, "install.html"), path.join(publica, "index.html"));
    const idx = path.join(publica, "idx");
    const fontesIdx = fs.existsSync(idx) ? fs.readdirSync(idx).filter(f => fs.statSync(path.join(idx, f)).isDirectory()) : [];
    if (removidosPublica.length) console.log(`[build] public/: removidos ${removidosPublica.join(", ")}`);
    console.log(`[build] public/: ${gerados.length} js + manifest.json copiados (idx: ${fontesIdx.length ? fontesIdx.join(", ") : "AUSENTE — rode tools/publicacao/gerar-indice.js"})`);
  }

  const teto = tetoDoIndice();
  if (teto) {
    console.log(
      `[build] indice: ${teto.total} itens | maior shard ${teto.chave} ${(teto.bytes / 1024).toFixed(0)} KB ` +
      `(teto do runtime ${(TETO_CORPO_BYTES / 1024).toFixed(0)} KB, ou ${(TETO_CORPO_LIMITED_BYTES / 1024).toFixed(0)} KB na quota limited)`
    );
  }
  if (removidos.length) console.log(`[build] dist/: removidos ${removidos.join(", ")}`);

  console.log(`[build] dist/: ${Object.keys(entradas).length} bundles + manifest.json; publico: mirrorstream.js`);
  console.log(`[build] registro (src/core/fontes/): ${fontes.chaves().length} fontes internas | manifesto declara ${manifest.scrapers.length} scraper agregado`);
  console.log(`[build] TMDB_API_KEY: ${tmdbKey ? "injetada nos bundles" : "AUSENTE — ver aviso acima"}`);
  console.log(`[build] mirrorstream.js ofuscado: ${tamanhoOfuscado.antes} -> ${tamanhoOfuscado.depois} bytes (sem sourcemap)`);
}

main().catch((e) => {
  console.error("[build] erro:", e && e.message ? e.message : e);
  process.exit(1);
});
