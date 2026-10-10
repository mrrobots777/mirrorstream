// O QUE O APARELHO NAO TEM, e o que o codigo nao pode usar.
//
// MEDIDO 08/10/2026: o runtime do Nuvio e' um motor JS embarcado, nao Node. O `CONTRATO.md`
// lista o que existe — `fetch`, `crypto.subtle`, CryptoJS, `cheerio`, `atob`/`btoa`,
// `TextEncoder`/`TextDecoder`, `URL`, `setTimeout` — e o que NAO existe: `process`, `Buffer`,
// modulos Node, DOM, `WebAssembly`, `new Function`.
//
// Um bundle que use qualquer uma dessas coisas passa em `npm test` (que roda em Node, onde
// tudo existe) e estoura no celular ou na TV. Este arquivo trava a classe de defeito no
// CODIGO, sem depender de `dist/` existir, para o erro aparecer em `npm test` e nao so no
// aparelho.
//
// O complementro e' `tools/validacao/simular-sandbox.js`, que carrega os bundles ja construidos num
// contexto que reproduz a lista fechada. Este e' o guarda de texto; aquele e' o de execucao.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const fontes = require("../src/core/fontes");

// Cada padrao e' uma coisa que o CONTRATO lista como ausente. O nome do item e' o que o
// leigo leria no erro.
const PROIBIDOS = [
  { re: /\brequire\s*\(\s*["'](fs|path|http|https|net|os|crypto|stream|zlib|child_process|worker_threads|cluster|vm|assert)["']\s*\)/g, nome: "require de modulo Node" },
  { re: /\bprocess\s*\.\s*(env|argv|exit|cwd|platform|version)\b/g, nome: "acesso a process" },
  { re: /\bBuffer\s*\.\s*(from|alloc|allocUnsafe|isBuffer|concat)\b/g, nome: "Buffer (nao existe no runtime)" },
  { re: /\b__dirname\b|\b__filename\b/g, nome: "__dirname/__filename" },
  { re: /\bWebAssembly\b/g, nome: "WebAssembly (morto no runtime)" },
  { re: /\bDecompressionStream\b/g, nome: "DecompressionStream (ausente no motor embarcado)" },
  { re: /\bnew\s+Function\s*\(/g, nome: "new Function (codeGeneration desligado)" },
  { re: /\bdocument\s*\.\s*(createElement|querySelector|querySelectorAll|getElementById)/g, nome: "DOM" },
  { re: /\bnavigator\s*\.\s*(userAgent|platform|language)/g, nome: "navigator (o aparelho nao expoe)" },
  { re: /\b(localStorage|sessionStorage|indexedDB)\b/g, nome: "storage do navegador" },
  { re: /\bnew\s+(Worker|SharedWorker|ServiceWorker)\b/g, nome: "Worker (o motor nao cria)" }
];

// `tools/` e `test/` rodam em Node e podem usar o que quiserem; o que vai para o aparelho e'
// `src/`. O `build.js` TAMBEM fica de fora de proposito: ele roda em Node na maquina de
// quem publica, e e' ele que faz o bundle — coloca-lo nesta lista seria exigir que o
// proprio arquivo que constroi o plugin nao pudesse usar `fs`.
function arquivosDoPlugin() {
  const saida = [];
  const anda = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const arq = path.join(dir, nome);
      const st = fs.statSync(arq);
      if (st.isDirectory()) anda(arq);
      else if (nome.endsWith(".js")) saida.push(arq);
    }
  };
  anda(path.join(RAIZ, "src"));
  return saida;
}

test("nenhum modulo de src/ usa o que o runtime do aparelho nao tem", () => {
  const problemas = [];
  for (const arq of arquivosDoPlugin()) {
    const txt = fs.readFileSync(arq, "utf8");
    for (const { re, nome } of PROIBIDOS) {
      re.lastIndex = 0;
      if (re.test(txt)) problemas.push(`${path.relative(RAIZ, arq)}: ${nome}`);
    }
  }
  assert.deepEqual(problemas, [], `o runtime do Nuvio nao tem:\n  ${problemas.join("\n  ")}`);
});

test("todo require de src/ aponta para modulo do projeto ou para cheerio/crypto-js", () => {
  // O `require` do aparelho so' aceita `cheerio*` e `crypto-js`; qualquer outro nome lanca.
  // A checagem e' sobre o TEXTO do `require`, porque o bundle e' CommonJS e o esbuild
  // resolve os caminho em build — um `require` dinamico escapa da resolucao e estouraria
  // so no aparelho.
  const problems = [];
  for (const arq of arquivosDoPlugin()) {
    const txt = fs.readFileSync(arq, "utf8");
    const re = /require\(\s*["']([^"']+)["']\s*\)/g;
    let m;
    while ((m = re.exec(txt))) {
      const id = m[1];
      if (/^(cheerio|crypto-js)(\/|$)/.test(id)) continue;
      if (id.startsWith(".")) continue; // caminho relativo = modulo do projeto
      problems.push(`${path.relative(RAIZ, arq)}: require("${id}")`);
    }
  }
  assert.deepEqual(problems, [], `o runtime aceita so cheerio e crypto-js:\n  ${problems.join("\n  ")}`);
});

test("o registro declara um arquivo de scraper que existe para toda fonte ativa", () => {
  // Fonte sem arquivo e' fonte que quebra em runtime com "module is not defined" — o
  // `build` falha antes, mas o teste deixa o motivo explicito.
  const faltando = [];
  for (const chave of fontes.chavesTodos()) {
    const arq = path.join(RAIZ, fontes.caminhoDe(chave));
    if (!fs.existsSync(arq)) faltando.push(`${chave} -> ${fontes.caminhoDe(chave)}`);
  }
  assert.deepEqual(faltando, []);
});

test("toda fonte ativa tem idx ou catalogo: sem os dois ela devolve [] de proposito", () => {
  // Nao e' falha, e' a propriedade que o registro garante: ou ha indice publicado, ou o
  // scraper tem `catalogo: true` para buscar na origem. As duas ausentes nao dariam link
  // em hipotese alguma, e o motivo fica no proprio arquivo.
  const semNada = [];
  for (const chave of fontes.chaves()) {
    if (fontes.FONTES[chave].idx) continue;
    const arq = path.join(RAIZ, fontes.caminhoDe(chave));
    const txt = fs.existsSync(arq) ? fs.readFileSync(arq, "utf8") : "";
    if (/catalogo:\s*false/.test(txt)) semNada.push(chave);
  }
  assert.deepEqual(semNada, [], "fonte sem indice e com catalogo desligado nunca entrega link");
});

test("o manifesto declara um único scraper agregado", () => {
  const manifesto = fontes.manifesto();
  assert.deepEqual(manifesto.scrapers.map((s) => s.id), ["mirrorstream"]);
  // E o que o app le da tela de Plugins: um scraper sem `filename` nao baixa, e um
  // `supportedTypes` vazio some da tela de filtro.
  for (const s of manifesto.scrapers) {
    assert.equal(s.filename, `${s.id}.js`);
    assert.ok(Array.isArray(s.supportedTypes) && s.supportedTypes.length, `${s.id} sem supportedTypes`);
    // O app so' conhece "movie" e "tv" (ver `CONTRATO.md`); um terceiro valor some da tela
    // de filtro sem erro. E nao e' exigir os DOIS: uma fonte so de serie (`types: ["tv"]`)
    // e' legitima e e' o caso de ISE, SAN e DGO.
    for (const t of s.supportedTypes) {
      assert.ok(t === "movie" || t === "tv", `${s.id} com tipo "${t}" fora do contrato do app`);
    }
    assert.ok(typeof s.description === "string" && s.description.trim(), `${s.id} sem descricao`);
  }
});
