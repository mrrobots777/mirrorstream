# Plan 2 — Scrapers robustos: prazo que cobre o corpo, e nada de opção silenciosamente ignorada

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fetch in either addon server is bounded by one deadline that covers **headers and body**, and every timeout option a caller passes is actually honoured — no option silently ignored, no body read with no limit.

**Architecture:** The plugin already solved this (`plugin/src/lib/http.js:13-43` — `comPrazo()` wraps the response so `estouroDoCorpo` fires a hard deadline over `res.text()`). The two addon servers never got that fix: `browserFetch` relies on Node's socket **inactivity** timeout, which a trickling body never trips. Separately, mirrorview received an `ms` alias for `timeout` and mirrorstream did not — so `playerflix.js:81` asking for 5 000 ms silently gets 15 000.

**Tech Stack:** Node ≥18, CommonJS, no new dependencies. Tests use a **local** HTTP server (precedent: `test/caminho-do-byte.test.js`) — never the internet.

**Spec:** `docs/superpowers/specs/2026-10-03-fontes-e-seguranca.md` — section "Frente 2".

## Global Constraints

- Node local is **18** (`/usr/bin/node`). Never `/tmp/node-v22.*` — `better-sqlite3` SIGSEGVs.
- **CommonJS only.** `mirrorstream/` and `mirrorview/` must keep **zero code of the other product** — fix each copy in its own tree; do **not** extract a shared module across the two.
- No comments in new code unless the surrounding file already documents heavily (both do; match register).
- **Errors must propagate.** A network/timeout/429/5xx **raises**; `[]` is only a valid answer when the origin *responded* and had nothing. This is decision 131 and it already cost 327 → 217 channels once.
- Every edit under `mirrorview/` requires: `node tools/gerar-branch-mirrorview.js` (else `test/mirrorview-branch.test.js` fails).
- Barrier (the three directories CI runs): `node --test test/ mirrorstream/test/ mirrorview/test/`
- **`plugin/test/` exists but is not in CI.** `.github/workflows/testes.yml` runs only those three, and `test/workflows.test.js:77` asserts the floor formula `total=$((ms + mv + repo))` **exactly** — adding a fourth barrier breaks that test unless it is updated in the same change. Task 4 does both together.

## Review Focus

| Input / failure mode | Expected behaviour | Test that pins it |
|---|---|---|
| Headers arrive instantly, body trickles 1 byte/s past the budget | Rejected with `timeout de Nms` — not hung | Task 1 Step 1 (local server, trickled body) |
| Body is fast but headers hang | Rejected with the same message | Task 1 Step 1 (second local case) |
| Caller passes `ms:` and the callee only reads `timeout` | Budget honoured, not 15 000 | Task 2 Step 1 |
| A redirect chain whose last hop stalls | Total deadline still applies across hops | Task 1 Step 1 (third local case) |
| Origin returns 429 | Throws — never becomes `[]` | Task 3 Step 1 |
| Caller passes both `ms` and `timeout` | `timeout` wins (explicit beats alias) | Task 2 Step 1 |

---

### Task 1: One deadline covering headers **and** body

**Files:**
- Modify: `mirrorstream/src/lib/scraper-utils.js:126-248` (`browserFetch`)
- Modify: `mirrorview/src/lib/scraper-utils.js` (same function, own copy)
- Test: `test/prazo-corpo.test.js` (create, root `test/`)

**Interfaces:**
- Consumes: existing `browserFetch(url, opts) -> Promise<{ok,status,headers,text(),json(),buffer()}>`.
- Produces: unchanged return shape. New internal helper `comPrazo(res, ms, alvo) -> res` that mirrors `plugin/src/lib/http.js:13-43`. Later tasks depend on `browserFetch`'s signature staying identical.

**The bug, stated precisely:** `req.on("timeout", ...)` (line 247) is Node's socket **inactivity** timeout. A body that keeps sending a byte a second is never inactive, so the read can run unbounded. AGENTS records the same defect in the plugin costing DGO **21.3 s → 5.7 s**.

- [ ] **Step 1: Write the failing test**

In `test/prazo-corpo.test.js`, using a local `http.createServer` (no network). Three cases:

```js
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { browserFetch } = require("../mirrorstream/src/lib/scraper-utils");

function servidor(resposta) {
  return new Promise((ok) => {
    const s = http.createServer(resposta);
    s.listen(0, "127.0.0.1", () => ok(s));
  });
}
const porta = (s) => s.address().port;

test("corpo que goteja passa do prazo e e cortado", async () => {
  const s = await servidor((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("inicio");
    const relogio = setInterval(() => res.write("x"), 200);
    res.on("close", () => clearInterval(relogio));
  });
  const url = `http://127.0.0.1:${porta(s)}/lento`;
  await assert.rejects(
    () => browserFetch(url, { timeout: 800 }).then((r) => r.text()),
    /timeout de 800ms/,
    "corpo gotejante nao pode passar do prazo"
  );
  s.close();
});

test("cabecalho que nunca chega tambem e cortado", async () => {
  const s = await servidor(() => { /* nunca responde */ });
  const url = `http://127.0.0.1:${porta(s)}/mudo`;
  await assert.rejects(() => browserFetch(url, { timeout: 800 }), /timeout de 800ms/);
  s.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/mirror && node --test test/prazo-corpo.test.js`
Expected: the **first** case FAILS (hangs past 800 ms, then errors with a different message or resolves). The second case should already pass — it proves the harness is wired correctly before you change anything.

- [ ] **Step 3: Add `comPrazo` to `mirrorstream/src/lib/scraper-utils.js`**

Model it on `plugin/src/lib/http.js:13-43`: wrap `text`/`json`/`buffer`/`arrayBuffer` so that a `setTimeout(ms)` armed at response time rejects the pending read with `new Error(\`timeout de ${ms}ms em ${alvo}\`)`, cleared on settle. Arm it **once at the start of `browserFetch`** so it covers the redirect recursion at line 251 too — the budget belongs to the whole call, not to one hop.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/mirror && node --test test/prazo-corpo.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Port the same change to `mirrorview/src/lib/scraper-utils.js`**

Its own copy — **do not** import from `mirrorstream`. Re-run Step 4 pointed at a second test file (`test/prazo-corpo-mirrorview.test.js`) with the same two cases, to prove the port rather than assume it.

- [ ] **Step 6: Run the full barrier**

Run: `cd /home/ubuntu/mirror && node --test test/ mirrorstream/test/ mirrorview/test/`
Expected: all pass; total ≥ the CI floor in `.github/workflows/testes.yml`

- [ ] **Step 7: Commit**

```bash
git add mirrorstream/src/lib/scraper-utils.js mirrorview/src/lib/scraper-utils.js test/prazo-corpo.test.js test/prazo-corpo-mirrorview.test.js
git commit -m "fix: prazo do browserFetch cobre cabecalho E corpo nos dois addons"
```

---

### Task 2: A caller's timeout option must never be silently ignored

**Files:**
- Modify: `mirrorstream/src/lib/scraper-utils.js:126`
- Test: `test/prazo-opcoes.test.js` (create)

**Interfaces:**
- Consumes: Task 1's `browserFetch`.
- Produces: `browserFetch` accepts `opts.ms` as an alias of `opts.timeout`.

**Measured drift:** `mirrorview/.../scraper-utils.js:136` already reads `opts.timeout || opts.ms || 15000`. `mirrorstream/.../scraper-utils.js:126` reads `opts.timeout || 15000`. Meanwhile `mirrorstream/src/scrapers/playerflix.js:81` passes `ms: 5000` — it silently gets 15 000, five times the budget it asked for.

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert");
const { browserFetch } = require("../mirrorstream/src/lib/scraper-utils");

// mesmo helper do Task 1: `servidor(resposta)` devolve o server, `porta(s)` le a porta.
// Um handler vazio nunca responde — e' o caso de cabecalho que trava.
function servidorNuncaResponde() {
  return servidor(() => { /* nunca responde */ });
}

test("opts.ms e honrado como alias do timeout", async () => {
  const s = await servidorNuncaResponde();
  const url = `http://127.0.0.1:${porta(s)}/mudo`;
  const t0 = Date.now();
  await assert.rejects(() => browserFetch(url, { ms: 700 }), /timeout de 700ms/);
  assert.ok(Date.now() - t0 < 4000, "ms foi ignorado e o default de 15000 foi usado");
  s.close();
});

test("timeout explicito vence o alias ms", async () => {
  const s = await servidorNuncaResponde();
  const url = `http://127.0.0.1:${porta(s)}/mudo`;
  await assert.rejects(() => browserFetch(url, { ms: 700, timeout: 900 }), /timeout de 900ms/);
  s.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/mirror && node --test test/prazo-opcoes.test.js`
Expected: FAIL — `timeout de 15000ms`

- [ ] **Step 3: Change line 126**

`const timeout = opts.timeout || opts.ms || 15000;` — exactly the expression mirrorview already has at its line 136. `opts.timeout` first, so explicit wins over alias.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/mirror && node --test test/prazo-opcoes.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Sweep for other call sites passing an option the callee drops**

Run: `cd /home/ubuntu/mirror && grep -rn "ms:" mirrorstream/src/scrapers mirrorview/src/scrapers`

For each hit, confirm the receiving function reads `ms`. Report findings in the commit message; fix any that are dropped, each with its own assertion in this test file.

- [ ] **Step 6: Commit**

```bash
git add mirrorstream/src/lib/scraper-utils.js test/prazo-opcoes.test.js
git commit -m "fix: mirrorstream honra opts.ms como alias do timeout (drift em relacao ao mirrorview)"
```

---

### Task 3: An error must surface, never become an empty list

**Files:**
- Test: `test/falha-honesta.test.js` (create, root `test/`)

**Interfaces:**
- Consumes: `browserFetch` from Task 1.

No production change expected — this task *proves* decision 131 still holds and traps the regression. If it fails, the fix belongs in whichever caller swallowed the error; do **not** weaken the test.

- [ ] **Step 1: Write the test**

```js
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

function sobe(status) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => { res.writeHead(status); res.end("x"); });
    s.listen(0, "127.0.0.1", () => ok(s));
  });
}

test("5xx sobe erro em vez de devolver lista vazia", async () => {
  const s = await sobe(503);
  const url = `http://127.0.0.1:${s.address().port}/a`;
  const { browserFetch } = require("../mirrorstream/src/lib/scraper-utils");
  const r = await browserFetch(url, { timeout: 2000 });
  assert.equal(r.ok, false, "5xx precisa ser reportado como resposta ruim, nao como sucesso");
  s.close();
});

test("429 sobe erro em vez de devolver lista vazia", async () => {
  const s = await sobe(429);
  const url = `http://127.0.0.1:${s.address().port}/b`;
  const { browserFetch } = require("../mirrorstream/src/lib/scraper-utils");
  const r = await browserFetch(url, { timeout: 2000 });
  assert.equal(r.status, 429);
  s.close();
});
```

- [ ] **Step 2: Run it**

Run: `cd /home/ubuntu/mirror && node --test test/falha-honesta.test.js`
Expected: PASS

- [ ] **Step 3: Run the full barrier**

Run: `cd /home/ubuntu/mirror && node --test test/ mirrorstream/test/ mirrorview/test/`
Expected: all pass; total ≥ the CI floor

- [ ] **Step 4: Commit**

```bash
git add test/falha-honesta.test.js
git commit -m "test: 5xx e 429 precisam subir como erro, nunca virar lista vazia (decisao 131)"
```

---

### Task 4: Bring `plugin/test/` into the CI barrier

**Files:**
- Modify: `.github/workflows/testes.yml` — add a `node --test plugin/test/` step and include it in the floor
- Modify: `test/workflows.test.js:66-85` — the assertions that pin the barrier shape
- Test: the existing `plugin/test/id-de-conteudo.test.js` becomes real coverage

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a barrier of **four** directories; the floor formula gains a `pl` term.

**Why this task exists:** `plugin/test/id-de-conteudo.test.js` is written and never executed by CI. A test that does not run is not a safety net — it is decoration. This is the same class of gap as a plan putting tests where CI never looks.

- [ ] **Step 1: Confirm the orphan test passes on its own**

Run: `cd /home/ubuntu/mirror && node --test plugin/test/`
Expected: PASS. If it fails, fix the test or the code **before** wiring it into CI — do not ship a red bar.

- [ ] **Step 2: Write the failing test for the barrier shape**

Extend `test/workflows.test.js` (it already owns this contract):

```js
test("a CI roda os testes do plugin", () => {
  const yml = fs.readFileSync(path.join(RAIZ, ".github/workflows/testes.yml"), "utf8");
  assert.ok(/node --test plugin\/test\//.test(yml), "a CI nao roda plugin/test/");
  assert.match(yml, /total=\$\(\(ms \+ mv \+ repo \+ pl\)\)/,
    "o piso tem de somar as quatro barreiras");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /home/ubuntu/mirror && node --test test/workflows.test.js`
Expected: FAIL — `a CI nao roda plugin/test/`

- [ ] **Step 4: Update `.github/workflows/testes.yml`**

Add a step running `node --test plugin/test/`, assign its count to `pl` alongside the existing `ms`/`mv`/`repo` (lines 101–103), and change the total to `total=$((ms + mv + repo + pl))`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/ubuntu/mirror && node --test test/workflows.test.js`
Expected: PASS — both the new assertion and the pre-existing `a CI conhece os tres produtos` (that one only checks the product name appears, so it still passes).

- [ ] **Step 6: Run the full barrier**

Run: `cd /home/ubuntu/mirror && node --test test/ mirrorstream/test/ mirrorview/test/ plugin/test/`
Expected: all pass; **update the CI floor number** to the new four-directory sum.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/testes.yml test/workflows.test.js
git commit -m "fix(ci): plugin/test entra na barreira — teste que nao roda nao e rede de seguranca"
```

---

## Out of scope for this plan (stated, not forgotten)

- **Not merging `mirrorstream` and `mirrorview` into one module.** The product boundary (zero code of the other) is deliberate; the drift is fixed by mirroring the change, and by Task 2's sweep, not by sharing.
- **Not adding a circuit breaker to the plugin.** The plugin runs on the device with no long-lived process; a per-invocation budget (`core/sandbox.js`) is the mechanism that exists. No measured failure requires more.
- **No device-sandbox budget assertion.** The Nuvio app's budget is not in this repo (no `.kt` files) — asserting a number we cannot verify would be a guess.
- Live-TV coverage, credential gate, rate limit: Plans 1 and 3.
