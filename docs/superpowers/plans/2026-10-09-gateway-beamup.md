# Gateway MirrorStream no BeamUp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a zero-dependency Node service on BeamUp that resolves streams for the plugin (`/resolve-batch`, `/health`, `/metrics`), moving orchestration off the device bundle, then turn the plugin into a thin client of it.

**Architecture:** A new `gateway/` directory runs the scrapers in Node by requiring `plugin/src/scrapers/**` directly, reusing `plugin/src/core/fontes` for ordering and `plugin/src/lib/agregador` for grouping + media-relay rewriting. The device bundle (`mirrorstream.js`) shrinks to one `fetch`. Cloudflare Workers keep media relay only.

**Tech Stack:** Node 18+, CommonJS, `node:test` / `node:assert/strict`, Node's `http` module. **No npm dependencies anywhere in `gateway/`.**

**Spec:** `docs/superpowers/specs/2026-10-09-gateway-beamup-design.md`

## Global Constraints

Every task inherits these; they are copied from the spec, not re-derived.

- **Zero npm dependencies in `gateway/`** — no `node_modules`, no `package.json` `dependencies` (spec §3). Only `devDependencies`-free scripts are allowed.
- **Node 18+**, CommonJS (`require`/`module.exports`) to match `plugin/` (spec §3).
- **`id` format `^[a-zA-Z0-9_:-]{1,120}$`** — colon allowed; `tmdb:603` and `tt0903747:1:1` must pass (spec §4).
- **Empty result is `200` with `streams: []`, never `404`** (spec §4).
- **`cache-control: no-store`** on `/health` and `/metrics` (spec §4).
- **Budget `6000 ms` default, clamped `1000`–`9000`**, env `MIRROR_ORCA_MS` (spec §5).
- **Per-source timeout `8000 ms`; first-result grace `700 ms`; `qualificaLista` cap `5000 ms`** (spec §5).
- **Wave `5` / reserve `5` / reserve-with-`preferida` `2`** (spec §5).
- **TTLs `300000` (complete) / `15000` (partial) / `30000` (negative); LRU `2000` per cache** (spec §6).
- **Cooldown `3` failures → `60000 ms`** (spec §7).
- **No `process.env` token anywhere in `plugin/src/**`** — `simular-sandbox.js:195` and `runtime-aparelho.test.js:28` scan for `/\bprocess\s*\.\s*(env|argv|exit|cwd|platform)/` and fail the build. `globalThis.X` is allowed.
- **No fallback to Cloudflare resolve Workers and no local-scraper path in the bundle** (spec §9).
- **`cd plugin && npm test` must stay green after every task.**
- **Commit cadence:** one commit per task (`git add <files> && git commit -m "…"`). At the end of Task 10 squash everything into the repo's single commit and push once. Rationale: the repo's rule is one published commit (CHANGELOG line 3), but amending per task would destroy intermediate checkpoints. Intermediate commits mirror the documented 08/10 exception.

## Review Focus

Five things the spec implies but no single task's happy-path test catches, each with the task that owns it.

1. **A bundle built while `GATEWAY_PADRAO` is still empty silently returns `[]` to every device** — the failure mode is "plugin installed, nothing plays, no error anywhere". Owned by Task 8: assert `resolveBatchUrl` returns `null` when no base is configured, and that the built bundle returns `[]` rather than throwing.
2. **`type`, `season` or `episode` arriving as `-` or garbage turns into `NaN` or a `500`** — spec allows `-`, and Nuvio passes `-` for movies. Owned by Task 7: assert `type=movie&season=-` answers `200`, and a bad `type` answers `400` without reaching any scraper.
3. **The Nuvio app's origin is unknown, so a missing CORS header blocks a perfectly good response** — nothing in the spec names an origin. Owned by Task 7: assert `Access-Control-Allow-Origin: *` on all three routes and `OPTIONS` → `204`.
4. **A stream that reaches `agruparStreams` without `__mirrorSource` skips `mediaWorkerDe` and loses `bingeGroup`** — media would bypass the relay and binge continuity would break. Owned by Task 6: assert every stream the resolver returns has `behaviorHints.bingeGroup` and a relay URL.
5. **One scraper throwing turns the whole response into `500`** — spec §9 requires a failing source to degrade to `[]` while others survive. Owned by Task 6: assert a rejecting `getStreams` still returns the other sources' streams with status `200`.

---

### Task 1: Scaffold + config

**Files:**
- Create: `gateway/package.json`
- Create: `gateway/config.js`
- Test: `gateway/test/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 2+): `config.carregaEnv(): void`; constants `config.PORTA: number`, `config.HOST: string` (`"0.0.0.0"`), `config.ORCA_MS: number`, `config.VERSAO: string` (`"1.0.0"`).

- [ ] **Step 1: Write the failing test**

`gateway/test/config.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../config");

test("ORCA_MS cai em 6000 sem env e respeita os limites 1000-9000", () => {
  assert.equal(config.ORCA_MS, 6000);                       // sem MIRROR_ORCA_MS
});
test("PORTA cai em 7000 sem env", () => {
  assert.equal(config.PORTA, 7000);
});
test("carregaEnv copia as chaves de segredo para globalThis", () => {
  process.env.TMDB_API_KEY = "chave-de-teste";
  config.carregaEnv();
  assert.equal(globalThis.TMDB_API_KEY, "chave-de-teste");
  delete process.env.TMDB_API_KEY;
  delete globalThis.TMDB_API_KEY;
});
test("sem MIRROR_EDGE_MODE o mediaWorkerDe continua ativo", () => {
  delete globalThis.MIRROR_EDGE_MODE;
  config.carregaEnv();
  const { edgeAtivo } = require("../../plugin/src/core/politica");
  assert.equal(edgeAtivo(), true);                          // sem isso a URL de mídia não é reescrita
});
```

The clamp test needs `MIRROR_ORCA_MS` extremes; add a case that re-requires `../config` under `process.env.MIRROR_ORCA_MS="99999"` and expects `9000`, and under `"10"` expecting `1000`. Use `delete require.cache[…]` between cases.

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../config'`

- [ ] **Step 3: Create `gateway/package.json` and implement `gateway/config.js`**

`package.json`: `name: "mirrorstream-gateway"`, `private: true`, `engines.node: ">=18"`, scripts `test: "node --test test/*.test.js"` and `start: "node servidor.js"`. No `dependencies`.

`config.js` exports `{ carregaEnv, PORTA, HOST, ORCA_MS, VERSAO }`. `carregaEnv()` copies this exact list from `process.env` into `globalThis`, only when the env value is a non-empty string:

```
TMDB_API_KEY, MIRROR_SPC_USER, MIRROR_SPC_PASS, MIRROR_BLZ_USER, MIRROR_BLZ_PASS,
MIRROR_BLZ_CATALOGO, MIRROR_ATO_USER, MIRROR_ATO_PASS, MIRROR_INDEX_BASE,
MIRROR_EDGE_MODE, MIRROR_QUALIDADE
```

(spec §8, which enumerates all 11. Only 7 of them — `TMDB_API_KEY`, `MIRROR_SPC_USER/PASS`,
`MIRROR_BLZ_USER/PASS`, `MIRROR_ATO_USER/PASS` — actually come from secrets in
`infra/workers/edge-worker-entry.js`; the other four are set elsewhere in that worker's
startup. Verified by review of Task 1: the 11-key list is the authority, not the worker file.)
This file is gateway-only, so `process.env` is allowed here.

- [ ] **Step 4: Run to verify it passes**

Run: `cd gateway && node --test test/config.test.js`
Expected: PASS, all cases

- [ ] **Step 5: Commit**

```bash
git add gateway/package.json gateway/config.js gateway/test/config.test.js
git commit -m "feat(gateway): scaffold e config do servico"
```

---

### Task 2: Carregamento e seleção das fontes

**Files:**
- Create: `gateway/fontes.js`
- Test: `gateway/test/fontes.test.js`

**Interfaces:**
- Consumes: `plugin/src/core/fontes` — `chaves(): string[]` (active, in `ORDEM`), `chavesTodos(): string[]`, `caminhoDe(chave): string`, `fonte(chave): { tipos: string[], ativo?: boolean }`.
- Produces (Task 6): `fontes.carrega(): { total: number, ativas: number, falhas: Array<{chave: string, erro: string}> }`; `fontes.elegiveis(tipo: "movie"|"tv"): Array<{ chave: string, getStreams: Function }>`; `fontes.total(): number`; `fontes.ativas(): number`.

- [ ] **Step 1: Write the failing test**

`gateway/test/fontes.test.js`:

```js
test("o boot carrega todos os scrapers ativos do registro (spec §11 caso 12)", () => {
  const r = fontes.carrega();
  assert.deepEqual(r.falhas, [], `scrapers que falharam: ${JSON.stringify(r.falhas)}`);   // deepEqual: compara conteúdo, não referência
  assert.equal(r.ativas, fontes.total());
  assert.ok(r.ativas >= 9, `esperava >= 9 fontes ativas, veio ${r.ativas}`);
});
test("elegiveis mantém a ORDEM do registro e filtra por tipo", () => {
  const filme = fontes.elegiveis("movie").map(f => f.chave);
  const tv = fontes.elegiveis("tv").map(f => f.chave);
  assert.deepEqual(filme, fontes.chaves().filter(c => fontes.tiposDe(c).includes("movie") || !fontes.tiposDe(c).length));
  assert.deepEqual(tv, fontes.chaves().filter(c => fontes.tiposDe(c).includes("tv") || !fontes.tiposDe(c).length));
  assert.deepEqual(filme, fontes.chaves().filter(c => filme.includes(c)), "filtra, mas preserva a ORDEM");
  assert.notDeepEqual(filme, tv);          // filme e tv têm conjuntos diferentes (só 2 animes são tv-only)
});
test("fonte desativada (ato) não aparece em nenhuma seleção", () => {
  const todas = [...fontes.elegiveis("movie"), ...fontes.elegiveis("tv")].map(f => f.chave);
  assert.ok(!todas.includes("ato"), "ato está com ativo:false no registro");
});
test("todo getStreams carregado é função", () => {
  for (const f of [...fontes.elegiveis("movie"), ...fontes.elegiveis("tv")]) {
    assert.equal(typeof f.getStreams, "function", f.chave);
  }
});
```

Expose `fontes.tiposDe(chave)` and `fontes.chaves()` as thin pass-throughs so the test needs no direct registry import.

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && node --test test/fontes.test.js`
Expected: FAIL — `Cannot find module '../fontes'`

- [ ] **Step 3: Implement `gateway/fontes.js`**

Path to the repo root from `gateway/` is `path.join(__dirname, "..")`; scraper file is `path.join(raizRepo, "plugin", fontes.caminhoDe(chave))`.

`carrega()` requires every entry of `fontes.chaves()` **once**, stores `{ chave, getStreams }` in an internal `Map` keyed in `chaves()` order, and catches per-chapter failures into `falhas: [{ chave, erro: String(e && e.message || e) }]` — one bad scraper must not stop the boot (spec §14). Calling `carrega()` twice is idempotent.

`elegiveis(tipo)` returns the loaded entries in `chaves()` order whose `fontes.fonte(c).tipos` is empty or includes `tipo`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd gateway && node --test test/fontes.test.js`
Expected: PASS, all cases

- [ ] **Step 5: Verify the plugin suite is still green**

Run: `cd plugin && npm test`
Expected: PASS (`# pass 66` / `# fail 0` — verified baseline after Task 1)

- [ ] **Step 6: Commit**

```bash
git add gateway/fontes.js gateway/test/fontes.test.js
git commit -m "feat(gateway): carrega e seleciona as fontes do registro"
```

---

### Task 3: Cache (positivo, negativo, LRU, coalescimento)

**Files:**
- Create: `gateway/cache.js`
- Test: `gateway/test/cache.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 6): `criaCache(opcoes?: { teto?: number, agora?: () => number }) => Cache`, where

```js
Cache = {
  pega(chave: string): any | null,                  // null se ausente ou expirado (expirado é apagado)
  guarda(chave: string, valor: any, ttlMs: number): void,
  emVoo(chave: string, produz: () => Promise<any>): Promise<any>,  // coalescimento
  contagem(tipo: "positivo" | "negativo"): number,  // valor.streams.length > 0 ? positivo : negativo
  tamanho(): number
}
```

- [ ] **Step 1: Write the failing test**

`gateway/test/cache.test.js` — inject `agora` as a mutable clock (`let t = 0; const agora = () => t;`).

```js
test("guarda e devolve dentro do TTL, e devolve null depois (spec §6)", () => {
  const c = criaCache({ agora });
  c.guarda("k", { streams: [1] }, 300000);
  assert.deepEqual(c.pega("k"), { streams: [1] });
  t += 300000;
  assert.equal(c.pega("k"), null);          // TTL do positivo completo: 300000
});
test("contagem separa positivo de negativo pelo streams.length", () => {
  const c = criaCache({ agora });
  c.guarda("a", { streams: [1] }, 1000); c.guarda("b", { streams: [] }, 1000);
  assert.equal(c.contagem("positivo"), 1);
  assert.equal(c.contagem("negativo"), 1);
});
test("LRU expulsa a entrada mais antiga ao passar do teto (spec §6)", () => {
  const c = criaCache({ teto: 2, agora });
  c.guarda("1", { streams: [] }, 1000); c.guarda("2", { streams: [] }, 1000);
  c.guarda("3", { streams: [] }, 1000);
  assert.equal(c.tamanho(), 2);
  assert.equal(c.pega("1"), null);          // a mais antiga saiu
  assert.ok(c.pega("2")); assert.ok(c.pega("3"));
});
test("ler uma entrada a renova na ordem LRU", () => {
  const c = criaCache({ teto: 2, agora });
  c.guarda("1", { streams: [] }, 1000); c.guarda("2", { streams: [] }, 1000);
  c.pega("1");                              // 1 deixa de ser a mais antiga
  c.guarda("3", { streams: [] }, 1000);
  assert.ok(c.pega("1"), "1 foi lida, não pode ser expulsa");
  assert.equal(c.pega("2"), null);
});
test("emVoo coalesce: duas chamadas iguais executam produz() uma vez (spec §11 caso 6)", async () => {
  const c = criaCache({ agora });
  let chamadas = 0;
  const produz = async () => { chamadas++; await new Promise(r => setTimeout(r, 10)); return { streams: ["x"] }; };
  const [a, b] = await Promise.all([c.emVoo("k", produz), c.emVoo("k", produz)]);
  assert.equal(chamadas, 1);
  assert.deepEqual(a, b);
  // depois de resolver, a chave sai de voo e pode calcular de novo
  await c.emVoo("k", produz);
  assert.equal(chamadas, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && node --test test/cache.test.js`
Expected: FAIL — `Cannot find module '../cache'`

- [ ] **Step 3: Implement `gateway/cache.js`**

Two internal `Map`s: entries (key → `{ valor, expira }`, insertion order = LRU order) and in-flight (key → `Promise`). `emVoo` registers with `finally(() => inFlight.delete(chave))` so a rejected producer releases the key (spec §6: "a entrada sai em `finally`"). LRU: on `pega` hit, `delete` + `set` to move the key to the end; on `guarda` past `teto`, `delete` the first key with `map.keys().next().value`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd gateway && node --test test/cache.test.js`
Expected: PASS, all cases

- [ ] **Step 5: Commit**

```bash
git add gateway/cache.js gateway/test/cache.test.js
git commit -m "feat(gateway): cache com TTL, LRU e coalescimento"
```

---

### Task 4: Estado por fonte (cooldown)

**Files:**
- Create: `gateway/estado.js`
- Test: `gateway/test/estado.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 6, Task 7): `criaEstado(opcoes?: { falhasLimite?: number, cooldownMs?: number, agora?: () => number }) => Estado`,

```js
Estado = {
  sucesso(chave: string): void,      // zera falhas
  falha(chave: string): void,        // falhas++ ; ao chegar em falhasLimite, agenda ate = agora + cooldownMs e zera falhas
  emCooldown(chave: string): boolean,
  emCooldownTotal(): number,
  candidatas(chaves: string[]): string[]   // remove as em cooldown; se sobrar vazio, devolve a entrada inteira
}
```

- [ ] **Step 1: Write the failing test**

`gateway/test/estado.test.js`, with an injected mutable clock:

```js
test("3 falhas põem a fonte fora por 60000 ms (spec §7, spec §11 caso 8)", () => {
  const e = criaEstado({ agora });
  e.falha("spc"); e.falha("spc"); assert.equal(e.emCooldown("spc"), false);
  e.falha("spc");
  assert.equal(e.emCooldown("spc"), true);
  assert.equal(e.emCooldownTotal(), 1);
  t += 59999; assert.equal(e.emCooldown("spc"), true);
  t += 1;     assert.equal(e.emCooldown("spc"), false);   // voltou sozinha
});
test("sucesso zera as falhas acumuladas", () => {
  const e = criaEstado({ agora });
  e.falha("blz"); e.falha("blz"); e.sucesso("blz");
  e.falha("blz"); e.falha("blz");
  assert.equal(e.emCooldown("blz"), false);   // seria 4 falhas, mas o sucesso zerou
});
test("candidatas remove as em cooldown, e se sobrar vazio devolve todas (spec §7)", () => {
  const e = criaEstado({ agora });
  e.falha("a"); e.falha("a"); e.falha("a");
  assert.deepEqual(e.candidatas(["a", "b"]), ["b"]);
  e.falha("b"); e.falha("b"); e.falha("b");
  assert.deepEqual(e.candidatas(["a", "b"]), ["a", "b"], "sem nenhuma saudável, todas voltam");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && node --test test/estado.test.js`
Expected: FAIL — `Cannot find module '../estado'`

- [ ] **Step 3: Implement `gateway/estado.js`**

Per-key record `{ falhas: number, ate: number }`. `emCooldown` compares `ate > agora()` and treats an expired record as clean (`falhas = 0, ate = 0`). Defaults `falhasLimite: 3`, `cooldownMs: 60000`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd gateway && node --test test/estado.test.js`
Expected: PASS, all cases

- [ ] **Step 5: Commit**

```bash
git add gateway/estado.js gateway/test/estado.test.js
git commit -m "feat(gateway): cooldown por fonte apos 3 falhas"
```

---

### Task 5: Métricas

**Files:**
- Create: `gateway/metricas.js`
- Test: `gateway/test/metricas.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (Task 6, Task 7): `criaMetricas() => Metricas`,

```js
Metricas = {
  resolve(cache: "hit"|"miss"|"parcial"|"negativo"|"erro"): void,
  fonte(fonte: string, resultado: "ok"|"vazio"|"erro"): void,
  resposta(ms: number): void,
  render(info: { fontes: {total: number, ativas: number, em_cooldown: number},
                 cache: {positivo: number, negativo: number} }): string
}
```

- [ ] **Step 1: Write the failing test**

`gateway/test/metricas.test.js`:

```js
test("render devolve texto Prometheus com content-type compatível (spec §4, spec §11 caso 10)", () => {
  const m = criaMetricas();
  m.resolve("hit"); m.resolve("hit"); m.resolve("erro");
  m.fonte("spc", "ok"); m.fonte("spc", "erro");
  m.resposta(812); m.resposta(188);
  const txt = m.render({ fontes: { total: 10, ativas: 9, em_cooldown: 1 },
                         cache: { positivo: 12, negativo: 3 } });
  assert.match(txt, /^gateway_up 1$/m);
  assert.match(txt, /^gateway_resolve_total\{cache="hit"\} 2$/m);
  assert.match(txt, /^gateway_resolve_total\{cache="erro"\} 1$/m);
  assert.match(txt, /^gateway_fonte_total\{fonte="spc",resultado="ok"\} 1$/m);
  assert.match(txt, /^gateway_cache_entradas\{tipo="negativo"\} 3$/m);
  assert.match(txt, /^gateway_fontes_em_cooldown 1$/m);
  assert.match(txt, /^gateway_resposta_ms_soma 1000$/m);
  assert.match(txt, /^gateway_resposta_ms_total 2$/m);
  assert.ok(!txt.includes("NaN"));
});
test("rótulos saem em ordem estável para não gerar série nova a cada render", () => {
  const m = criaMetricas();
  m.resolve("miss");
  const a = m.render(info), b = m.render(info);
  assert.equal(a, b);
});
```

Note `gateway_fontes_total`, `gateway_fontes_ativas`, `gateway_fontes_em_cooldown`, `gateway_cache_entradas{tipo=…}` and `gateway_resposta_ms_*` are gauges that come from `info`, not from the counters.

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && node --test test/metricas.test.js`
Expected: FAIL — `Cannot find module '../metricas'`

- [ ] **Step 3: Implement `gateway/metricas.js`**

Counters in plain objects with fixed label sets (every `cache` value and every `resultado` value pre-seeded to `0`, so a counter never appears only after its first event). `render` joins lines with `\n` and ends with a trailing `\n`. Label order inside `{…}` is fixed as written in spec §4 (`cache="…"`, then `fonte="…",resultado="…"`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd gateway && node --test test/metricas.test.js`
Expected: PASS, all cases

- [ ] **Step 5: Commit**

```bash
git add gateway/metricas.js gateway/test/metricas.test.js
git commit -m "feat(gateway): contadores e texto Prometheus"
```

---

### Task 6: Orquestração (`resolve`)

**Files:**
- Create: `gateway/resolve.js`
- Test: `gateway/test/resolve.test.js`

**Interfaces:**
- Consumes:
  - `fontes.carrega()`, `fontes.elegiveis(tipo)` (Task 2)
  - `criaCache()` (Task 3)
  - `criaEstado()` (Task 4)
  - `criaMetricas()` (Task 5)
  - `plugin/src/lib/agregador` → `agruparStreams(listas: any[][]): any[]`
  - `plugin/src/lib/qualifica` → `qualificaLista(lista: any[]): Promise<any[]>`
- Produces (Task 7): `criaResolve(dependencias) => async resolve(requisicao) => Resposta`,

```js
requisicao = { id: string, tipo: "movie"|"tv", temporada: number|null, episodio: number|null, preferida?: string }
Resposta   = { streams: any[], fontes: string[], cache: "HIT"|"MISS"|"PARCIAL"|"NEGATIVO", ms: number }
dependencias = { fontes, estado, cache, metricas, orcaMs, agora?, chamaFonte? }
```

`chamaFonte` is injectable so tests need no network; its contract is `async (chave, req) => any[]`, and it must never throw (a rejection counts as a source failure).

- [ ] **Step 1: Write the failing test**

`gateway/test/resolve.test.js` — build the resolver with fake `fontes` (a stub `elegiveis` returning fixed keys in order), a stub `chamaFonte`, an injected clock, and `globalThis.MIRROR_QUALIDADE = "nunca"` so `qualificaLista` performs no video probing.

Declare once at the top of the file, since most cases reuse it:

```js
const req = { id: "tt0133093", tipo: "movie", temporada: null, episodio: null };
const reqTv = { id: "tt0903747", tipo: "tv", temporada: 1, episodio: 1 };

const fontes = require("../fontes"); fontes.carrega();     // usa o registro REAL
let chamadas = [];             // ordem de chaves chamadas, zerada em beforeEach
const streamDe = (chave) => ({ url: `https://cdn.example/${chave}.mp4`, quality: "720p", title: "Dublado" });
const chamaFontePadrao = async (chave) => { chamadas.push(chave); return [streamDe(chave)]; };

function novoResolve(fn = chamaFontePadrao) {
  return criaResolve({ fontes, estado, cache, metricas, orcaMs: 6000, agora, chamaFonte: fn });
}
const resolve = novoResolve();
```

Using the real registry is deliberate: it is what pins the `ORDEM` assertion to
`plugin/src/core/fontes` instead of to a stub that could be edited to agree with itself.
Each case that needs another behaviour (slow source, throwing source, everything empty)
calls `novoResolve(comSeuChamaFonte)` — `chamaFonte` is the only thing that varies.

```js
test("ordem de prioridade: preferida → saudável → ORDEM (spec §5, caso 1)", async () => {
  // preferida dada → só ela é chamada na onda principal
  const chamadas = [];
  const r = await resolve({ id: "tt1", tipo: "tv", temporada: 1, episodio: 1, preferida: "mirrorstream:spc" });
  assert.deepEqual(chamadas, ["spc"]);
});
test("preferida inexistente ou de tipo incompatível é ignorada (spec §5, caso 3)", async () => {
  const r = await resolve({ ...reqTv, preferida: "mirrorstream:naoexiste" });
  assert.ok(r.fontes.length > 1, "sem preferida válida cai na onda normal");
});
test("onda principal é no máximo 5 fontes na ORDEM do registro (spec §5, caso 2)", async () => {
  const r = await resolve(reqTv);
  const esperado = fontes.elegiveis("tv").slice(0, 5).map(f => f.chave);
  assert.equal(r.fontes.length, 5);
  assert.deepEqual(r.fontes, esperado, "é a ORDEM do registro, não rodízio");
});
test("onda vazia dispara reserva de até 5 ainda não consultadas (spec §5, caso 2)", async () => {
  // chamaFonte devolve [] para os 5 primeiros, lista para os próximos
  const r = await resolve({ id: "tt3", tipo: "tv", temporada: 1, episodio: 1 });
  assert.ok(r.fontes.length > 5, `reserva não rodou: ${r.fontes}`);
  assert.ok(r.streams.length > 0);
  assert.equal(new Set(r.fontes).size, r.fontes.length, "nenhuma fonte consultada duas vezes");
});
test("preferida vazia aciona reserva de 2 (spec §5)", async () => {
  const r = await resolve({ id: "tt4", tipo: "tv", temporada: 1, episodio: 1, preferida: "mirrorstream:blz" });
  assert.equal(r.fontes.length, 3);        // 1 preferida + 2 reserva
});
test("cache completo devolve HIT sem chamar scraper nenhum (spec §11 caso 4)", async () => {
  await resolve(req);                       // MISS
  const r2 = await resolve(req);
  assert.equal(r2.cache, "HIT");
  assert.deepEqual(r2.fontes, []);
});
test("resultado vazio é NEGATIVO na chamada seguinte (spec §11 caso 5)", async () => {
  // chamaFonte sempre []
  const r = await resolve(req); assert.equal(r.cache, "MISS"); assert.deepEqual(r.streams, []);
  const r2 = await resolve(req); assert.equal(r2.cache, "NEGATIVO");
});
test("duas chamadas idênticas simultâneas executam cada fonte uma vez (spec §11 caso 6)", async () => {
  const [a, b] = await Promise.all([resolve(req), resolve(req)]);
  assert.equal(chamadas.length, 5);      // 5 da onda, não 10
  assert.deepEqual(a, b);
});
test("além do orçamento responde PARCIAL e regrava o cache completo depois (spec §11 caso 7)", async () => {
  // chamaFonte: 4 fontes resolvem rápido, 1 demora orcaMs + 50.
  // Use orcaMs: 100 em `novoResolve` para este caso — o teste não espera 6 s.
  const r = await resolve(req);
  assert.equal(r.cache, "PARCIAL");
  await new Promise(res => setTimeout(res, 250));   // a tarefa lenta termina e o cache é regravado
  const r2 = await resolve(req);
  assert.equal(r2.cache, "HIT");
});
test("uma fonte que rejeita não derruba as outras (spec §9, Review Focus 5)", async () => {
  // chamaFonte lança para "blz" e devolve lista para as demais
  const r = await resolve(req);
  assert.ok(r.streams.length > 0, "as fontes saudáveis responderam");
  assert.ok(r.fontes.includes("blz"), "blz foi consultada e consta na resposta");
  assert.ok(r.streams.every(s => !/mirrorstream:blz$/.test(s.behaviorHints.bingeGroup)),
            "nenhum stream veio da fonte que falhou");
});
test("tudo stream devolvido tem bingeGroup e URL no relay (Review Focus 4)", async () => {
  const r = await resolve({ id: "tt5", tipo: "movie", temporada: null, episodio: null });
  assert.ok(r.streams.length > 0);
  for (const s of r.streams) {
    assert.match(s.behaviorHints.bingeGroup, /^mirrorstream:[a-z]+$/);
    assert.match(s.url, /workers\.dev\/proxy\?media=1&url=/);   // reescrito por agruparStreams
  }
});
test("fonte em cooldown sai da seleção e aparece no total (spec §7, caso 8)", async () => {
  // 3 falhas em "shg" → próxima consulta não a inclui
  const r = await resolve(req);
  assert.ok(!r.fontes.includes("shg"));
});
test("falha TOTAL não vira cache negativo (spec §9: resposta inválida não é guardada)", async () => {
  // chamaFonte lança para TODAS as fontes — outage do painel, não "não tem este título"
  const r = await resolve(req);
  assert.deepEqual(r.streams, []);
  assert.equal(r.cache, "MISS");            // não NEGATIVO: nada foi guardado
  const r2 = await resolve(req);
  assert.equal(r2.cache, "MISS", "a segunda chamada refaz, sem herdar o outage por 30 s");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && node --test test/resolve.test.js`
Expected: FAIL — `Cannot find module '../resolve'`

- [ ] **Step 3: Implement `gateway/resolve.js`**

`criaResolve` closes over the injected dependencies. The body follows spec §5 "Fluxo de uma consulta" verbatim: positive cache → negative cache → `emVoo` → main wave → `Promise.race([todas, primeira.then(+700), timeout(orcaMs)])` → `agruparStreams` → reserve wave when empty → background rewrite of the cache with the complete result.

Selection (`spec §5`): candidates = `fontes.elegiveis(tipo)` filtered by `estado.candidatas`; if `preferida` matches an eligible key, the main wave is that key alone, else the first `5`. Mark every source list with `__mirrorSource = chave` **before** passing it to `agruparStreams` — that field is what drives `mediaWorkerDe` and `bingeGroup` (Review Focus 4). Each source failure → `estado.falha(chave)`, list `[]`, `metricas.fonte(chave, "erro")`; a source returning `[]` → `metricas.fonte(chave, "vazio")`; non-empty → `"ok"` and `estado.sucesso(chave)`.

`ms` is `agora() - inicio` at response time.

Two rules the tests above pin but the flow text does not state:

- **`metricas.resolve(…)` takes the lowercase label** (`"hit"`, `"miss"`, `"parcial"`, `"negativo"`, `"erro"`) while the response body carries the uppercase `cache` value — lowercase at the metric boundary.
- **All sources failing is not a negative result.** If every consulted source *errored* (threw / timed out) and none returned successfully, respond `streams: []` with `cache: "MISS"` and write **nothing** to the cache. Only a consultation where at least one source answered cleanly may store the empty result as negative for `30000 ms`. This is what reconciles spec §6 (negative = `streams.length === 0`) with spec §9 (an invalid response is never stored): "no source has this title" is cached, "the panels are down" is not.

- [ ] **Step 4: Run to verify it passes**

Run: `cd gateway && node --test test/resolve.test.js`
Expected: PASS, all cases

- [ ] **Step 5: Verify the plugin suite is still green**

Run: `cd plugin && npm test`
Expected: PASS (`# pass 66` / `# fail 0` — verified baseline after Task 1)

- [ ] **Step 6: Commit**

```bash
git add gateway/resolve.js gateway/test/resolve.test.js
git commit -m "feat(gateway): orquestracao com prioridade, ondas e orcamento"
```

---

### Task 7: Servidor HTTP (as três rotas)

**Files:**
- Create: `gateway/servidor.js`
- Test: `gateway/test/servidor.test.js`

**Interfaces:**
- Consumes: `criaResolve` (Task 6), `fontes` (Task 2), `cache` (Task 3), `estado` (Task 4), `metricas` (Task 5), `config` (Task 1).
- Produces (Task 10): `criaServidor(apis) => http.Server`, where `apis = { resolve, fontes, estado, cache, metricas }` — `resolve` is passed **already built** (a test can swap in one that throws). Callers `listen` on their own port; `servidor.js` run directly (`require.main === module`) builds everything and listens on `config.PORTA`/`config.HOST`.

- [ ] **Step 1: Write the failing test**

`gateway/test/servidor.test.js` — start the server on port `0`, read the assigned port, `fetch` it, close in `after()`.

Setup block at the top of the file, used by every case:

```js
let chamadas = 0;              // quantas vezes um scraper foi alcançado
let visto = null;              // última requisição recebida pelo chamaFonte
const chamaFonte = async (chave, r) => { chamadas++; visto = r; return [{ url: "https://cdn.example/v.mp4", quality: "720p", __mirrorSource: chave }]; };

const apis = {
  resolve: null,               // montado em before(): criaResolve({ fontes, estado, cache, metricas, orcaMs: 6000, chamaFonte })
  fontes, estado, cache, metricas
};
// `criaServidor(apis)` escuta porta 0 em before();
// `base` = `http://127.0.0.1:${porta}`; `chamadas` zera em beforeEach().
```

```js
test("GET /resolve-batch valida id e type antes de tocar em qualquer fonte (caso 9)", async () => {
  let chamadas = 0;                              // chamaFonte conta
  const r400 = await fetch(`${base}/resolve-batch?id=..&type=movie`);
  assert.equal(r400.status, 400);                // id ".." não passa no regex
  assert.equal(chamadas, 0, "validação é pré-scraper");
  const rTipo = await fetch(`${base}/resolve-batch?id=tt1&type=serie`);
  assert.equal(rTipo.status, 400);
  assert.equal(chamadas, 0);
});
test("id com dois-pontos passa (spec §4 — tmdb:603 e tt0903747:1:1)", async () => {
  for (const id of ["tmdb:603", "tt0903747:1:1", "tt0133093"]) {
    const r = await fetch(`${base}/resolve-batch?id=${encodeURIComponent(id)}&type=movie`);
    assert.equal(r.status, 200, id);
  }
});
test("season/episode em '-' não vira NaN nem erro (Review Focus 2)", async () => {
  const r = await fetch(`${base}/resolve-batch?id=tt1&type=movie&season=-&episode=-`);
  assert.equal(r.status, 200);
  assert.equal(visto.temporada, null, "virou null, não NaN");
  assert.equal(visto.episodio, null);
});
test("resposta vazia é 200 com streams [] (spec §4)", async () => {
  const r = await fetch(`${base}/resolve-batch?id=tt9&type=movie`);
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).streams, []);
});
test("método não-GET é 405 e OPTIONS é 204, ambos com CORS (Review Focus 3)", async () => {
  const r = await fetch(`${base}/resolve-batch?id=x&type=movie`, { method: "POST" });
  assert.equal(r.status, 405);
  const o = await fetch(`${base}/resolve-batch`, { method: "OPTIONS" });
  assert.equal(o.status, 204);
  assert.equal(o.headers.get("access-control-allow-origin"), "*");
});
test("as três rotas mandam Access-Control-Allow-Origin: * (Review Focus 3)", async () => {
  for (const p of ["/health", "/metrics", "/resolve-batch?id=a&type=movie"]) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.headers.get("access-control-allow-origin"), "*", p);
  }
});
test("rota desconhecida é 404", async () => {
  assert.equal((await fetch(`${base}/nada`)).status, 404);
});
test("/health vem com no-store e os contadores certos (spec §4, caso 10)", async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.ok(b.fontes.total >= b.fontes.ativas, "total nunca pode ficar abaixo de ativas");
  assert.equal(b.fontes.em_cooldown <= b.fontes.ativas, true, "em_cooldown é subconjunto de ativas");
  assert.equal(typeof b.versao, "string");
  assert.ok(b.uptime_s >= 0);
  assert.ok(b.cache.positivo >= 0 && b.cache.negativo >= 0);
});
test("/metrics vem no formato Prometheus e com no-store (caso 10)", async () => {
  const r = await fetch(`${base}/metrics`);
  assert.match(r.headers.get("content-type"), /^text\/plain; version=0\.0\.4/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(await r.text(), /^gateway_up 1$/m);
});
test("exceção dentro de resolve devolve 500 JSON, não stack (spec §4)", async () => {
  // servidor montado com um resolve que lança — use o mesmo helper do setup
  const quebrado = criaServidor({ ...apis, resolve: async () => { throw new Error("estouro"); } });
  await new Promise(res => quebrado.listen(0, res));
  try {
    const r = await fetch(`http://127.0.0.1:${quebrado.address().port}/resolve-batch?id=tmdb:603&type=movie`);
    assert.equal(r.status, 500);
    const b = await r.json();
    assert.equal(b.erro, "interno");
    assert.ok(!("stack" in b), "stack nunca vaza para o cliente");
    assert.equal(r.headers.get("access-control-allow-origin"), "*", "erro também precisa de CORS");
  } finally { await new Promise(res => quebrado.close(res)); }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd gateway && node --test test/servidor.test.js`
Expected: FAIL — `Cannot find module '../servidor'`

- [ ] **Step 3: Implement `gateway/servidor.js`**

`http.createServer` routing by `req.method` + `new URL(req.url, "http://x").pathname`. Order matters: `OPTIONS` → `204` + CORS + `access-control-allow-methods: GET, OPTIONS` → return; non-`GET` → `405` JSON; then path dispatch (`/resolve-batch`, `/health`, `/metrics`, else `404`).

Parse `season`/`episode`: a value of `-`, an empty string or a non-numeric string becomes `null`; a numeric string becomes `Number(...)`. Validate `id` against `^[a-zA-Z0-9_:-]{1,120}$` and `type` against `/^(movie|tv)$/` **before** calling `resolve`.

Every response gets `access-control-allow-origin: *`; `/health` and `/metrics` additionally get `cache-control: no-store`. Wrap the whole handler in try/catch → `500 {"erro":"interno"}` with `content-type: application/json; charset=utf-8`.

CORS headers must also be present on the error responses (400/405/404/500) — a preflight-blocked 400 looks like a network failure in the app.

- [ ] **Step 4: Run to verify it passes**

Run: `cd gateway && node --test test/servidor.test.js`
Expected: PASS, all cases

- [ ] **Step 5: Run the whole gateway suite**

Run: `cd gateway && node --test test/*.test.js`
Expected: PASS — all six suites

- [ ] **Step 6: Smoke the three endpoints locally**

```bash
cd gateway && node servidor.js &
curl -s localhost:7000/health
curl -s "localhost:7000/metrics" | head -5
curl -s "localhost:7000/resolve-batch?id=tmdb:603&type=movie"
kill %1
```

Expected: `health` JSON with `ok:true`; `metrics` starting with `gateway_up 1`; `resolve-batch` returning JSON (either `streams` or `[]`) — never a stack trace.

- [ ] **Step 7: Commit**

```bash
git add gateway/servidor.js gateway/test/servidor.test.js
git commit -m "feat(gateway): servidor http com resolve-batch, health e metrics"
```

---

### Task 8: `resolveBatchUrl` no plugin

**Files:**
- Modify: `plugin/src/core/politica.js` (add function + export; nothing removed yet)
- Test: `plugin/test/media-edge.test.js` (append cases)

**Interfaces:**
- Consumes: nothing.
- Produces (Task 9): `resolveBatchUrl(args: any[], preferida?: string) => string | null`, exported from `plugin/src/core/politica`. `args` is the raw `getStreams` spread: `[id, tipo, temporada, episodio, …extras]`.

- [ ] **Step 1: Write the failing test**

Append to `plugin/test/media-edge.test.js`:

```js
const { resolveBatchUrl } = require("../src/core/politica");

test("resolveBatchUrl monta a URL do gateway com todos os parâmetros", () => {
  globalThis.MIRROR_GATEWAY = "https://gw.example";
  const url = resolveBatchUrl(["tt1632701", "tv", 2, 16], "mirrorstream:spc");
  assert.equal(url, "https://gw.example/resolve-batch?id=tt1632701&type=tv&season=2&episode=16&preferida=mirrorstream%3Aspc");
});

test("season/episode ausentes viram '-', como o resolve-edge fazia", () => {
  globalThis.MIRROR_GATEWAY = "https://gw.example";
  const url = resolveBatchUrl(["603", "movie", null, null]);
  assert.match(url, /season=-/);
  assert.match(url, /episode=-/);
  assert.ok(!url.includes("preferida"), "sem preferida não há parâmetro");
});

test("sem gateway configurado devolve null (Review Focus 1)", () => {
  delete globalThis.MIRROR_GATEWAY;
  delete process.env.MIRROR_GATEWAY;          // não pode existir, mas garante o estado
  assert.equal(resolveBatchUrl(["603", "movie", null, null]), null);
});

test("id com dois-pontos sobrevive ao encodeURIComponent", () => {
  globalThis.MIRROR_GATEWAY = "https://gw.example";
  const url = resolveBatchUrl(["tmdb:603", "movie", null, null]);
  assert.ok(url.includes("id=tmdb%3A603"));
});
```

**Note:** `globalThis.MIRROR_GATEWAY` must be cleaned up (`delete`) at the end of each test or the following tests inherit it. Put the cleanup in the test bodies.

- [ ] **Step 2: Run to verify it fails**

Run: `cd plugin && node --test test/media-edge.test.js`
Expected: FAIL — `resolveBatchUrl is not a function`

- [ ] **Step 3: Implement `resolveBatchUrl` in `plugin/src/core/politica.js`**

```js
const GATEWAY_PADRAO = "";   // gravado no passo 3 do deploy (spec §12)

function gatewayBase() {
  return globalThis.MIRROR_GATEWAY || GATEWAY_PADRAO || null;
}

function resolveBatchUrl(args, preferida) {
  const base = gatewayBase();
  if (!base || !Array.isArray(args) || !args[0]) return null;
  // monta id/type/season/episode/ preferida, com season/episode em "-" quando nulos
}
```

Add both to `module.exports`. **Do not use `process.env` anywhere in this file** — it is bundled for the device and the sandbox rejects the token (Global Constraints).

- [ ] **Step 4: Run to verify it passes**

Run: `cd plugin && node --test test/media-edge.test.js`
Expected: PASS — new cases plus every pre-existing case (`edgeResolverDe`, `resolveWorkerDe`, `chaveResolucao` still exported)

- [ ] **Step 5: Run the whole plugin suite**

Run: `cd plugin && npm test`
Expected: PASS (`# pass 66` plus the new cases; 0 fail)

- [ ] **Step 6: Commit**

```bash
git add plugin/src/core/politica.js plugin/test/media-edge.test.js
git commit -m "feat(plugin): resolveBatchUrl aponta para o gateway"
```

---

### Task 9: Bundle agregado vira cliente fino

**Files:**
- Modify: `plugin/build.js` (`entradaAgregada`, around lines 205–310)
- Modify: `plugin/src/core/politica.js` (remove `edgeResolverDe`, `resolveWorkerDe`, `RESOLVE_WORKER_POR_FONTE` and their export)
- Modify: `plugin/test/media-edge.test.js` (rewrite the two cases that covered the removed functions)

**Interfaces:**
- Consumes: `resolveBatchUrl`, `preferenciaDe` logic (Task 8).
- Produces: the device bundle calls one `fetch` per `getStreams`.

- [ ] **Step 1: Rewrite the two obsolete test cases**

In `plugin/test/media-edge.test.js`, replace the cases `"cache de resolução usa chave estável e aceita warm-up de streams"` (uses `resolveWorkerDe`) and `"plugin monta chamada edge-first com os dados do episódio"` (uses `edgeResolverDe`). `chaveResolucao` **stays exported** — keep its stable-key assertion, drop the `resolveWorkerDe`/`edgeResolverDe` assertions.

- [ ] **Step 2: Run to verify the import of the removed functions fails**

Run: `cd plugin && node --test test/media-edge.test.js`
Expected: FAIL — `edgeResolverDe is not a function` / `resolveWorkerDe is not a function`

- [ ] **Step 3: Remove the dead exports from `plugin/src/core/politica.js`**

Delete `edgeResolverDe`, `resolveWorkerDe`, `RESOLVE_WORKER_POR_FONTE` (the map and the two builders) and their entries in `module.exports`. Keep `WORKER_POR_HOST`, `MEDIA_WORKER_POR_HOST`, `workerDe`, `mediaWorkerDe`, `chaveResolucao`, `deveTentarEdge`, `edgeAtivo`, `BACKOFF_MS`, `RETRIES`, `STATUS_RETRY_EDGE`, `resolveBatchUrl`.

- [ ] **Step 4: Run the plugin suite**

Run: `cd plugin && npm test`
Expected: PASS — this proves nothing else in `src/`, `test/` or `tools/` referenced the removed functions (`medir-rotas.js` uses `WORKER_POR_HOST`/`workerDe`, which stay)

- [ ] **Step 5: Replace `entradaAgregada()` in `plugin/build.js` with the thin client**

Generated code contract (this is the body the whole task exists for):

```js
const { resolveBatchUrl } = require("../src/core/politica");
async function getStreams(...args) {
  const url = resolveBatchUrl(args, preferenciaDe(args));
  if (!url || typeof fetch !== "function") return [];
  try {
    const res = await Promise.race([
      fetch(url, { headers: { Accept: "application/json" } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("gateway timeout")), 8000))
    ]);
    if (!res || !res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.streams) ? body.streams : [];
  } catch (_) { return []; }
}
module.exports = { getStreams };
```

`preferenciaDe`/`idDaPreferencia` stay generated in the bundle (spec §10: the `bingeGroup` is read on the device). Everything else the old generator emitted — `CACHE`, `INFLIGHT`, `ESTADO_FONTES`, `LOCKS_FONTES`, `cursorRodizio`, `selecionaFontes`, `chamaFonte`, `consultar`, `cacheResolucao`, `edgeResolucao`, `aqueceCacheResolucao`, and the `qualificaLista`/`agruparStreams` requires — is deleted from the generator. The `fontes` imports and `tmdbKey` preamble stay (the bundle still declares what it is).

- [ ] **Step 6: Build and check the bundle**

```bash
cd plugin && npm run build
node -e "const g=require('./dist/mirrorstream.js'); console.log(typeof g.getStreams)"
```

Expected: `function`. Then prove the empty-gateway failure mode explicitly (Review Focus 1):

```bash
node -e "
  const g = require('./dist/mirrorstream.js');
  g.getStreams('tt0133093','movie',null,null).then(r => console.log(JSON.stringify(r)));
"
```

Expected: `[]` — with `GATEWAY_PADRAO` still empty, no throw.

- [ ] **Step 7: Run the sandbox + contract gates**

```bash
cd plugin && npm test && npm run sandbox && node tools/validacao/auditoria-contrato.js
```

Expected: all green — the sandbox is what catches a `process.env` token or a Node `require` sneaking into the bundle (Global Constraints).

- [ ] **Step 8: Commit**

```bash
git add plugin/build.js plugin/src/core/politica.js plugin/test/media-edge.test.js plugin/dist plugin/public
git commit -m "feat(plugin): bundle agregado vira cliente fino do gateway"
```

---

### Task 10: Documentação, verificação final e publicação

**Files:**
- Modify: `docs/ARQUITETURA-BORDA.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md` (gateway section)

**Interfaces:**
- Consumes: everything.
- Produces: a single squashed, pushed commit.

- [ ] **Step 1: Update `docs/ARQUITETURA-BORDA.md`**

Add the gateway to the flow (step 1 of "Fluxo edge-first" now points at `/resolve-batch` on BeamUp instead of `/resolve-edge` per worker), state that the resolve Workers are retired and the media relay Workers remain, and document the three endpoints with their cache TTLs.

- [ ] **Step 2: Update `CHANGELOG.md`**

Record what entered, why, and what was measured — following the file's own voice (measured numbers, decisions, not a feature list). Include the two spec corrections found during planning:
- `process.env.MIRROR_GATEWAY` was impossible in `plugin/src` (sandbox regex) → resolution is `globalThis.MIRROR_GATEWAY || GATEWAY_PADRAO`.
- `tools/medicao/*` never used the resolve functions; only `media-edge.test.js` needed adjusting.

- [ ] **Step 3: Run every gate**

```bash
cd plugin && npm test && npm run build && npm run sandbox && node tools/validacao/auditoria-contrato.js
cd ../gateway && node --test test/*.test.js
cd .. && git status --short
```

Expected: every suite green, no untracked leftovers.

- [ ] **Step 4: End-to-end check against the local server**

```bash
cd gateway && node servidor.js & sleep 1
curl -s "localhost:7000/resolve-batch?id=tmdb:603&type=movie" | head -c 400
curl -s localhost:7000/health
kill %1
```

Expected: a JSON body whose `streams` entries carry `behaviorHints.bingeGroup` and a `workers.dev/proxy?media=1` URL, or `[]` for a title no source has.

- [ ] **Step 5: Squash into the repo's single commit and push**

```bash
# ANTES da Task 1, guarde a base do squash:
git rev-parse HEAD        # deve ser 9d03ad4 — anote este valor

# ao final da Task 10:
git reset --soft 9d03ad40b3caf86b02fd32c1c12210324fc8b09d
git commit --amend --no-edit
git push --force-with-lease origin master
```

Expected: exatamente um commit em `master` (o do spec + todo o trabalho), `origin/master` igual, árvore limpa.

- [ ] **Step 6: Confirm the published state**

```bash
git log --oneline -1 && git status -sb && git rev-parse master origin/master
```

Expected: one line of history, `## master...origin/master` with no ahead/behind, two identical SHAs.

---

## Deployment (not a task — blocked on credentials)

Ordered, because the bundle embeds the gateway URL (spec §12):

1. Register the SSH key with BeamUp **(owner's action, outside this plan)**.
2. Deploy the service; record the public URL.
3. Write that URL into `GATEWAY_PADRAO` in `plugin/src/core/politica.js`.
4. `cd plugin && npm run build`, publish the bundle.
5. Verify `/resolve-batch` from a real device.
6. Only then evaluate retiring the resolve Workers. The media-relay Workers stay.
