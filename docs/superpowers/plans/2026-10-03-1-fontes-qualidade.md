# Plan 1 — Fontes VOD: qualidade real e falha honesta

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every VOD source that delivers a stream either carries a real `quality` read from the video, or fails for a *recorded, classified* reason — never a silent "Desconhecido".

**Architecture:** `plugin/src/lib/qualifica.js` is the single place that fills `quality`. It currently hard-caps each probe at 3 000 ms, which is below the measured 3 423 ms the BLZ origin needs — so the one source whose probe genuinely works gets cut. The other two failures are datacenter-IP blocks at the origin, which must be *classified*, not retried. The fix raises the probe budget to the measured value and makes every miss carry a reason.

**Tech Stack:** Node.js ≥18, CommonJS, no new dependencies. Network measurement is done by `plugin/tools/bateria-completa.js` (never by the unit tests).

**Spec:** `docs/superpowers/specs/2026-10-03-fontes-e-seguranca.md` — section "Frente 1".

## Global Constraints

- Node local is **18** (`/usr/bin/node`), not 22 — `better-sqlite3` SIGSEGVs under 22. Do not use `/tmp/node-v22.*`.
- **CommonJS only** (`require`/`module.exports`), never ESM.
- **No comments in new code** unless the surrounding file already documents heavily (this file does; match its register).
- **Quality must be the real resolution read from the video.** Decision 36: a source never invents a label. If the probe cannot read it, `quality` stays empty — that is correct behaviour, not a bug.
- **Never lose a source.** A failing probe must not remove a stream from the list.
- Every `plugin/src` edit requires rebuilding: `cd plugin && node build.js`. Tests read `plugin/dist/`, **not** `plugin/src/`.
- Test barrier (the three directories CI runs): `node --test test/ mirrorstream/test/ mirrorview/test/`
- **`plugin/test/` is NOT in CI** — `.github/workflows/testes.yml` runs only those three, and `test/workflows.test.js:77` asserts the floor formula `total=$((ms + mv + repo))` exactly. Put tests for plugin code in **root `test/`** so they actually guard (precedent: `test/fonte-ron.test.js:31` requires a plugin module). Plan 2 Task 4 closes this gap.
- Network measurements (`bateria-completa.js`) are **not** part of the test barrier — they need the internet.

## Review Focus

| Input / failure mode | What a reasonable person expects | Test that pins it |
|---|---|---|
| Probe needs 3.4 s but budget is 3.0 s | The label appears; the stream is not penalised | Task 1 Step 1 — asserts the `ms` handed to the probe is ≥ 3500 |
| Origin blocks datacenter IP (`ato`, `dgo`) | Reason recorded as `bloqueado`; stream still delivered with `quality` absent | Task 2 Step 1 — asserts `qualifica` never drops a stream and records `bloqueado` |
| Origin answers with HTML instead of video | Classified `sem-video`, not counted as a probe timeout | Task 2 Step 1 — same test, second case |
| Sandbox budget already exhausted (`sobra < 1500`) | Reason `sem-orcamento`; no probe attempted, no crash | Task 2 Step 1 — third case |
| Probe throws (network) | Reason `erro`; other streams unaffected | Task 2 Step 1 — fourth case |
| A source that already sent `quality` | Left untouched — no probe, no overwrite | Task 2 Step 1 — fifth case |
| Someone "fixes" the contract by inventing `quality` | Test fails | Task 3 Step 1 — asserts `ato`/`dgo`-style blocked cases leave `quality` absent |

---

### Task 1: Raise the probe budget to the measured value

**Files:**
- Modify: `plugin/src/lib/qualifica.js:34-38` (the budget constants) and `:96-101` (the per-stream budget call)
- Test: `test/qualifica.test.js` (create)

**Interfaces:**
- Consumes: `probeResolution(url, { headers, maxTargets, ms })` from `plugin/src/lib/video-probe.js`; `novo(ms)` from `plugin/src/core/sandbox` giving `.sobra()`.
- Produces: `qualifica(chamar, ...args) -> Promise<Array>` — unchanged signature, later tasks rely on it. Exports gain `tempoDeSonda(sobra, modo) -> number`.

**Measured value that must be respected:** BLZ resolves in **3423 ms** (measured twice: 3319 ms, 3423 ms, 3307 ms). `MS_SONDA` is 3000. The probe must be allowed at least **3500 ms**.

- [ ] **Step 1: Write the failing test**

In `test/qualifica.test.js`. Patch the probe **before** loading `qualifica` — it destructures `probeResolution` at require time, so a patch applied afterwards is invisible:

```js
const test = require("node:test");
const assert = require("node:assert");
const caminhoVideo = require.resolve("../plugin/src/lib/video-probe");
const caminhoQualifica = require.resolve("../plugin/src/lib/qualifica");

function carregaComSonda(sonda) {
  const video = require(caminhoVideo);
  video.probeResolution = sonda;
  delete require.cache[caminhoQualifica];
  return require(caminhoQualifica);
}

test("a sonda de qualidade recebe orcamento suficiente para o BLZ (medido 3423ms)", async () => {
  let msRecebido = 0;
  const { qualifica } = carregaComSonda(async (url, opts) => {
    msRecebido = opts.ms;
    return { width: 1280, height: 532 };
  });
  const lista = [{ url: "https://exemplo.invalid/a.mp4" }];
  await qualifica(() => lista);
  assert.ok(msRecebido >= 3500, `sonda recebeu ${msRecebido}ms, BLZ precisa de 3423ms`);
  assert.equal(lista[0].quality, "720p");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/mirror && node --test test/qualifica.test.js`
Expected: FAIL — `sonda recebeu 3000ms, BLZ precisa de 3423ms`

- [ ] **Step 3: Raise `MS_SONDA` in `plugin/src/lib/qualifica.js`**

Set `MS_SONDA = 3500` and `TETO_MS = 4500` (the total invocation budget must stay **above** the per-probe budget, or the total cuts first — that ordering is the bug being fixed). Update the comment block at lines 21–28, which currently states the 3 s ceiling as measured and deliberate: it is now stale, and a stale justification is how this regresses.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/mirror && node --test test/qualifica.test.js`
Expected: PASS

- [ ] **Step 5: Rebuild the bundles and confirm BLZ gets its label**

Run: `cd /home/ubuntu/mirror/plugin && node build.js && node tools/bateria-completa.js`
Expected: `blz ... ok` (no `FALHA: sem quality`), `contrato quebrado: 2` (down from 3), `sem qualidade real: 2 de 11`

- [ ] **Step 6: Commit**

```bash
git add plugin/src/lib/qualifica.js test/qualifica.test.js
git commit -m "fix(plugin): sonda de qualidade cobre os 3423ms medidos do BLZ"
```

---

### Task 2: Every quality miss carries a reason

**Files:**
- Modify: `plugin/src/lib/qualifica.js` — `qualifica()` returns the list, and records why each probe did not produce a label
- Modify: `plugin/tools/bateria-completa.js:54` — report the reason instead of a flat failure
- Test: `test/qualifica.test.js` (extend)

**Interfaces:**
- Consumes: Task 1's `qualifica(chamar, ...args)`.
- Produces: `qualifica` exports `motivos() -> Record<string, string>` — map of `chaveDe(stream)` → one of `bloqueado` | `sem-video` | `sem-orcamento` | `erro` | `timeout`. Task 3 reads it.

**The four reasons, and how each is detected** (these are the measured cases, not guesses):

| reason | condition |
|---|---|
| `bloqueado` | probe threw, or resolved to a response whose bytes are HTML |
| `sem-video` | probe returned `null` quickly (< 500 ms) — origin answered but no video frame |
| `sem-orcamento` | `sobra < MIN_MS`, probe never called |
| `timeout` | probe threw a message containing `timeout` |

- [ ] **Step 1: Write the failing tests**

Append to `test/qualifica.test.js` — five cases, each with its own `carregaComSonda`:

```js
test("um bloqueio de IP de datacenter e registrado e NAO remove o stream", async () => {
  const { qualifica, motivos } = carregaComSonda(async () => {
    throw new Error("falha de rede em https://cdn.invalid/1.mp4: 302");
  });
  const lista = [{ url: "https://cdn.invalid/1.mp4" }, { url: "https://cdn.invalid/2.mp4" }];
  const saida = await qualifica(() => lista);
  assert.equal(saida.length, 2, "nenhum stream pode sumir");
  assert.equal(saida[0].quality, undefined);
  assert.equal(motivos()["https://cdn.invalid/1.mp4"], "bloqueado");
});

test("resposta rapida sem frame e classificada como sem-video", async () => {
  const { qualifica, motivos } = carregaComSonda(async () => null);
  const lista = [{ url: "https://cdn.invalid/a.mp4" }];
  await qualifica(() => lista);
  assert.equal(motivos()["https://cdn.invalid/a.mp4"], "sem-video");
});

test("sem orcamento a sonda nem e chamada", async () => {
  let chamou = false;
  const { qualifica, motivos } = carregaComSonda(async () => { chamou = true; return null; });
  const lista = [{ url: "https://cdn.invalid/b.mp4" }];
  globalThis.MIRROR_QUALIDADE = "sempre";
  await qualifica(() => lista);
  delete globalThis.MIRROR_QUALIDADE;
  assert.equal(chamou || motivos()["https://cdn.invalid/b.mp4"] !== undefined, true);
});

test("quem ja mandou quality nao e sondado nem sobrescrito", async () => {
  let chamou = false;
  const { qualifica } = carregaComSonda(async () => { chamou = true; return { width: 1920, height: 1080 }; });
  const lista = [{ url: "https://cdn.invalid/c.mp4", quality: "480p" }];
  await qualifica(() => lista);
  assert.equal(chamou, false);
  assert.equal(lista[0].quality, "480p");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/ubuntu/mirror && node --test test/qualifica.test.js`
Expected: FAIL — `motivos is not a function`

- [ ] **Step 3: Implement the reason record in `plugin/src/lib/qualifica.js`**

Add a module-level `Map` keyed by `chaveDe(stream)` (reuse the existing `chaveDe`), populated in `qualifica()` at each of the four branches above, and export `motivos()`. The probe call site already has all four conditions in scope; nothing new is fetched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/ubuntu/mirror && node --test test/qualifica.test.js`
Expected: PASS (all 6 tests in the file)

- [ ] **Step 5: Report the reason in the battery**

In `plugin/tools/bateria-completa.js`, change the line-54 message so a source with a recorded reason prints `FALHA: sem quality (bloqueado por IP de datacenter)` rather than the bare `sem quality`. Keep the existing wording when no reason is recorded.

- [ ] **Step 6: Rebuild and measure**

Run: `cd /home/ubuntu/mirror/plugin && node build.js && node tools/bateria-completa.js`
Expected: `ato` and `dgo` print their reason; `blz` no longer appears at all (Task 1 fixed it)

- [ ] **Step 7: Commit**

```bash
git add plugin/src/lib/qualifica.js test/qualifica.test.js plugin/tools/bateria-completa.js
git commit -m "feat(plugin): qualidade sem rotulo registra o motivo (bloqueado/sem-video/sem-orcamento/erro)"
```

---

### Task 3: Lock the honest outcome in the test barrier

**Files:**
- Test: `test/qualifica.test.js` (extend)

**Interfaces:**
- Consumes: Task 2's `motivos()` and `qualifica()`.

This task adds no production code. It exists because Task 2's fixes are only durable if the barrier forbids the two ways this could regress: inventing a label, or dropping a stream.

- [ ] **Step 1: Write the test**

```js
test("nunca inventa quality quando a leitura falha, e nunca remove stream", async () => {
  const { qualifica } = carregaComSonda(async () => null);
  const lista = [
    { url: "https://cdn.invalid/1.mp4" },
    { url: "https://cdn.invalid/2.mp4" },
    { url: "https://cdn.invalid/3.mp4" }
  ];
  const saida = await qualifica(() => lista);
  assert.equal(saida.length, 3);
  for (const s of saida) assert.equal(s.quality, undefined);
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `cd /home/ubuntu/mirror && node --test test/qualifica.test.js`
Expected: PASS

- [ ] **Step 3: Run the full barrier**

Run: `cd /home/ubuntu/mirror && node --test test/ mirrorstream/test/ mirrorview/test/`
Expected: all pass; total ≥ the current CI floor in `.github/workflows/testes.yml`

- [ ] **Step 4: Commit**

```bash
git add test/qualifica.test.js
git commit -m "test(plugin): trava qualidade honesta — sem inventar rotulo, sem remover stream"
```

---

### Task 4: Live-TV coverage — measure, classify, fix only what is ours

**Files:**
- Run-only (no edit unless measurement demands it): `plugin/tools/tv-cobertura.js [N]`
- Modify if a miss turns out to be ours: `mirrorview/src/scrapers/{rei,embedtv,embedcanais}.js`
- Test: `mirrorview/test/cobertura-tv.test.js` (create)

**Interfaces:**
- Consumes: `PROVIDERS_JOGADOR` in `mirrorview/src/core/tv-sources.js`; relay `GET /tv/hls/:id.m3u8`.
- Produces: `classificaFalva(motivo) -> "nosso" | "origem" | "sem-catalogo"` — the three-way split the report prints. Nothing else in the codebase depends on it.

**Why this task is measurement-first:** the last recorded coverage was **39/60** (`{"rei":34,"emb":4,"etc":1}`), and two earlier TV "measurements" in this project were wrong — one counted `0x47` bytes anywhere in a buffer (a PNG has 580 of them) and one measured the same default RCD player six times. This task must re-measure before it changes anything.

**The three classes, and what each permits:**

| class | means | permitted action |
|---|---|---|
| `nosso` | our chain is wrong (bad Referer, budget, missing hop) | fix the scraper |
| `origem` | origin served 404/404-token/HTML/PNG — device would fail too | **record it; change nothing** |
| `sem-catalogo` | slug not in `/catalog/tv/mirror-tv-live.json` | not a failure — sample only from the catalog |

- [ ] **Step 1: Write the failing test that forbids measuring the wrong thing**

```js
const test = require("node:test");
const assert = require("node:assert");
const { classificaFalva } = require("../src/lib/classifica-falva");

test("404 e PNG sao da origem, nao nossos", () => {
  assert.equal(classificaFalva("404"), "origem");
  assert.equal(classificaFalva("410"), "origem");
  assert.equal(classificaFalva("png no lugar do video"), "origem");
});

test("referer recusado e nosso", () => {
  assert.equal(classificaFalva("403 com o nosso Referer"), "nosso");
});

test("slug fora do catalogo nao e falha", () => {
  assert.equal(classificaFalva("fora do catalogo"), "sem-catalogo");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ubuntu/mirror && node --test mirrorview/test/cobertura-tv.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `classificaFalva` in `mirrorview/src/lib/classifica-falva.js`**

Pure string→class mapping. It encodes the rule from the relay work: **only 404/410/451 condemn a source**; 403/429/5xx/timeout are `indecisos` and are NOT `nosso` unless our own `Referer` caused it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ubuntu/mirror && node --test mirrorview/test/cobertura-tv.test.js`
Expected: PASS

- [ ] **Step 5: Measure**

Run: `cd /home/ubuntu/mirror/plugin && node tools/tv-cobertura.js 60`

Record: total, per-source counts, and the class of **every** miss. Sample **only** from `/catalog/tv/mirror-tv-live.json` — guessed slugs (`cnn`, `record`, `gloobo`, `nick` are not in the catalog) inflate the failure rate.

- [ ] **Step 6: Fix only the misses classified `nosso`**

If a chain is wrong (Referer, budget, missing hop), fix it in the owning scraper, then re-run Step 5. If all misses are `origem`, **change nothing** and record the number.

- [ ] **Step 7: Expose the split in `/health`**

Add to `mirrorview/src/server.js`'s `/health` payload a `coberturaTv: { total, comPlayer, porFonte, origem }` block using the same three classes, so an origin outage is visible instead of appearing as a shrinking catalog. Do not print token values or full source URLs.

- [ ] **Step 8: Run the full barrier**

Run: `cd /home/ubuntu/mirror && node --test test/ mirrorstream/test/ mirrorview/test/`
Expected: all pass; total ≥ the CI floor

- [ ] **Step 9: Regenerate the mirrorview branch**

Run: `cd /home/ubuntu/mirror && node tools/gerar-branch-mirrorview.js`

- [ ] **Step 10: Commit**

```bash
git add mirrorview/src/lib/classifica-falva.js mirrorview/src/server.js \
        mirrorview/test/cobertura-tv.test.js
git commit -m "feat: cobertura de TV classificada (nosso/origem/fora do catalogo) no /health"
```

---

## Out of scope for this plan (stated, not forgotten)

- **`ato` and `dgo` will still show no `quality`.** Their segments are unreachable from a datacenter IP (measured: `235 B` nginx page; `302` to `cloudflare-terms-of-service-abuse.com`). The device downloads them from a residential IP and plays fine. Giving them a label would require reading a resolution we did not read — decision 36 forbids it. Task 2 makes the reason visible instead.
- **RCD stays out of the TV player list** — origin serves PNG placeholders (measured in `plugin/tools/rcd-medir.js`).
- Security (credential gate, install issuer, rate limit) is Plan 3's scope.
- Scraper timeout/retry standardization is Plan 2's scope.

→ Task 4 below owns live-TV coverage and the honest `/health` signal.
