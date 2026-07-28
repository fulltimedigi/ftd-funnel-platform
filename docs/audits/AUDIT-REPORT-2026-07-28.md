# Codebase Audit — ftd-funnel-platform @ `0d356fa` · 2026-07-28 · Claude Code (claude-opus-4-8) · READ-ONLY

> **Frozen scope:** SHA `0d356fab955a2d91e38b7e5bc5e8de9e71193bc6`, whole repository, read-only. No code
> was modified — the deliverable is a verified-problem report; the owner decides fixes.
> **Governing rule:** a problem is listed ONLY with a concrete failure scenario that survived a reverse
> pass. **Confidence is earned by a PoC, not by consensus** — seven reviewers reading the same code share
> the same blind spots, so agreement is not evidence. The items marked **Reproduced** were settled by a
> throwaway script run locally (never committed); everything else is a hypothesis at its stated confidence.
>
> **This revision (v2)** incorporates a post-report review: it adds the systemic finding the first pass
> missed (SYS-1), re-ranks by constitutional weight, and **corrects two items by measurement** — the XSS
> escalation (verified *not* currently exploitable) and the render crash (measured as a clean failure, not
> a chokepoint breach → Medium).

## 1. Executive summary

**Overall health: a genuinely strong deterministic core, one reproduced Critical (SSRF), and — more
important than any single bug — a systemic enforcement gap: the "publishable?" decision is re-implemented
on three code paths instead of routed through one gate, and the manual "enumerate every entry point"
discipline has now failed for the sixth time.** That is the finding to act on.

The respondent **runtime** is safe to ship — worst case is an honest terminal, and it is XSS-safe by
construction (proven). The **authoring + publish + ingestion pipeline is not safe to run against untrusted
/ real sites yet**: a reproduced SSRF bypass, a constitutional no-fabrication breach on the AI path, a
public-config secret leak, and the enforcement gap all sit there.

**Biggest single risk:** `CRIT-1` — a DNS-rebinding SSRF bypass (`fetcher.js:140`) reproduced reaching
`169.254.169.254`. **Biggest structural risk:** `SYS-1` — no single publish-gate chokepoint.

**Counts:** Critical **1** · Systemic **1** · High **3** · Medium **11** · Low/Nit **~15**.
**XSS reclassified** from the first pass's "residual" to a *design-time guardrail* (verified not
exploitable today). **Render crash reclassified** High→Medium (measured clean failure).

**Top priorities:**
1. **CRIT-1** — SSRF DNS-skip bypass, *fully* (parsing + socket-pinning + redirects + block IP literals). Blocks any scrape of a site you don't own, including the first self-service merchant.
2. **SYS-1** — make "publishable?" one gate function + a CI invariant that no path can flip a funnel to ready/published without it. Fixes HIGH-2 and prevents the 7th recurrence.
3. **HIGH-1** — stop rendering AI-*inferred* advisory values as grounded "the product provides it" facts (a direct constitutional breach — grade-D evidence entering the runtime as truth).
4. Before any publish/embed: HIGH-3 (webhook secret → server-side lead responsibility) + the XSS guardrail (must land *before* single-file output ships).

---

## 2. Findings (most severe first)

### CRIT-1 · SSRF: DNS-rebinding guard skipped for any `0x…`-prefixed hostname
- **File:** `authoring/ingest/fetcher.js:140` · **Category:** untrusted-input security (SSRF) · **Confidence: Reproduced**
- **Defect:** `assertResolvesPublic()` is the only private-IP defense for a *real hostname*. To skip
  double-work on IP literals it short-circuits on `host.includes(":") || /^[0-9.]+$/.test(host) ||
  /^0x/i.test(host)` — **string-prefix heuristics, not "is this a literal IP already range-checked."**
  `0xdead.attacker.com` is a legal DNS name, not an IPv4 literal, yet matches `/^0x/i` → DNS resolution is
  skipped and the fetch proceeds to wherever the name resolves.
- **Failure scenario (reproduced):** fetcher given `http://0xdead.attacker.com/latest/meta-data/iam/security-credentials/`,
  attacker DNS answers `→ 169.254.169.254`. Repro: `reachedFetch=true` for the `0x` host; control hosts
  `evilhost.attacker.com` and `1.2.3.4.5.attacker.com` correctly `blocked-dns-private`. The server reads
  cloud-metadata / IAM credentials. Reachable via a scope URL, a `302 Location:`, or a sitemap `<loc>` — all
  attacker-controlled. Ingestion's whole job is fetching untrusted brand sites, so it is squarely on-path.
- **Fix direction — the proposed one-liner is necessary but NOT sufficient.** Gating the skip on
  `parseIPv4Any(host) != null || host.includes(":")` closes the *parsing* hole (0x, pure-decimal, octal,
  mixed like `0x7f.1`) **only if `parseIPv4Any` is complete**. It does **not** close:
  - **DNS-rebinding TOCTOU** — validated resolution ≠ the IP `fetch` later connects to. The only real fix
    is **socket pinning**: resolve once, validate, and connect to *that* IP via a custom `lookup`/agent
    (Host header preserved) — never resolve twice.
  - **Redirects** — re-validate every hop (already done for the literal+DNS guard; keep it, and ensure the
    pinned-IP path also applies per hop).
  - **IPv6 internal forms** — `::ffff:169.254.169.254` (mapped), `fe80::/10` (link-local), `fc00::/7` (ULA).
  - **A public name whose A record points internal** — must validate the *resolved address*, never the text.
  - **Simplest hardening for this product (do this too):** you scrape *public storefronts* — **block IP
    literals entirely and require a public, registrable domain.** That removes half the attack surface in
    one rule. Add regression tests with an injected `lookup` returning a private IP for a `0x`-hostname
    (`tests/ssrf.test.mjs` only covers `0x…` *IP literals*, so the suite misses the hostname case).

### SYS-1 · No single publish-gate chokepoint — "publishable?" is re-implemented on 3 paths (6th recurrence of the pattern)
- **Files:** `platform/jobs/generateJob.js` (`recordFrom`) · `platform/studio.js` (`_gatesGreen`) · `platform/review/review.html:271` (`_proofCoverage`) · **Category:** enforcement architecture / vision-invariant · **Confidence: Confirmed**
- **Defect:** three code paths each decide "is this funnel ready/publishable" with their *own* logic. The
  server job and studio route through `verifyFunnel` (correct); the browser review screen uses the weaker
  config-only `_proofCoverage` (HIGH-2). This is not a new bug — it is a **regression of a control we already
  built**: we previously found two publish entries, unified the gate, and wrote a reachability test — and a
  **third entry (`review.html`) slipped past it.** The "enumerate every entry point by hand" rule was applied
  and still came up short. By the operator's count this is the **sixth time** this family of "built-but-a-path-
  was-missed" has recurred.
- **Why it matters:** the lesson is *not* "close the third path." A human counting entry points will miss the
  seventh. The control must become **structural and automated.**
- **Fix direction:** (1) extract ONE `publishGate(config, catalog) → {ok, report}` used verbatim by all three
  paths (server computes it and *carries the result* to the review screen — the draft handoff already carries
  the config; carry `verify` beside it). (2) Add a **CI invariant** that fails the build if any call site of
  `buildArtifact`/publish is reachable without that gate's result — e.g. an AST/lint check that `buildArtifact`
  is only ever called with a verified gate object, plus a test enumerating *all* state→"ready/published"
  transitions and asserting each goes through `publishGate`. Enumeration becomes the machine's job, not a
  reviewer's.

### HIGH-1 · Constitutional breach: AI-*inferred* advisory values rendered as grounded "the product provides it" facts
- **Files:** `authoring/author/index.js:199-201` + `authoring/ai/enrichAuthor.js` (advisory axes marked `provenance:"ai-inference"`) · **Category:** vision-invariant (no fabrication / evidence-grading) · **Confidence: Confirmed (code) / Plausible (reaches a shopper — needs the AI-enrichment path enabled)**
- **Why this is ranked first among the High set:** it is the *only* finding that attacks the product's core
  value rather than its security. Grade-D (token-inferred) evidence was ruled "review-only, must not enter the
  runtime"; here an unverified inference is asserted to a shopper as a grounded promise. This is precisely the
  fabrication the entire platform exists to prevent, and the gates cannot see it.
- **Defect:** `designToAxes` marks AI-guessed axes `advisory:true, provenance:"ai-inference"` (its own comment:
  "verifies FORM, not TRUTH"). But `index.js:199` builds `carries` from `axisSet.map(...)` with **no `advisory`
  filter**, and line 201 pushes a `why` bullet `«اخترت ${label}، و«${name}» يوفّرها»` ("you chose X and «product»
  provides it") for **every** carried axis — including the inferences.
- **Failure scenario:** the model infers `occasion=formal` from a product name; the result asserts, as a
  definitive grounded reason, that the product provides the shopper's chosen occasion. The advisory axis *is* an
  asked signal, so `trustValidate` sees "claim resolves from an answer" and passes; anti-bland checks
  mirror/dominance, not truth-vs-form — the exact class CLAUDE.md warns the gates miss.
- **Fix direction:** for `provenance:"ai-inference"` axes, suppress the per-axis grounded `why`/`whyNot` bullet
  or emit a disclosed/hedged form ("راعينا تفضيلك…") that never asserts *verified provision*. Add a test that no
  grounded "يوفّرها" bullet is emitted for an advisory axis. **Gate before the first real merchant.**

### HIGH-2 · The browser review screen publishes on a weaker gate than `verifyFunnel` (the concrete face of SYS-1)
- **Files:** `platform/review/review.html:271,199-204` + `reviewModel.js:49-56,66` · **Category:** gate-bypass · **Confidence: Confirmed**
- **Defect:** `review.html` calls `buildReviewModel({config, trust, bland})` **without `verify`** (line 271) →
  `_proofCoverage(config)` fallback (reviewModel.js:66); `verifyFunnel` is **never called** here (verified by
  grep). On `model.ok` it calls `buildArtifact(...)` directly (line 204). `_proofCoverage` only checks that
  `proof.product_id`/`match_state` *fields exist* (never that the product is in the catalog) **and** returns
  `ok:true` when `commerce.length===0` (line 55 — the zero-denominator vacuous-truth `verifyFunnel.js:138`
  closes).
- **Failure scenario:** a COMMERCE rule with `proof:{product_id:"https://not-in-catalog/x", match_state:"EXACT"}`,
  or a terminals-only funnel, passes trust + bland + `_proofCoverage` → operator is told "ready to publish" and
  handed a real embed snippet; `verifyFunnel` would reject it. **Runtime mitigation:** `certifyForRender` still
  draws a *terminal* for an off-catalog/proofless path — so this is a **trust/honesty breach (operator misled),
  not a fabricated-card breach** (why it is High, not Critical).
- **Fix direction:** this is fixed by SYS-1 (route review.html through the one `publishGate`; harden
  `_proofCoverage` to fail-closed on `commerce.length===0` if a catalog-free screen must remain). Add the missing
  test pinning the review.html path against the authoritative gate.

### HIGH-3 · Tenant webhook / Sheets URL (secret-in-URL class) ships in the public funnel config
- **Files:** `platform/publish.js:46-64` (`applySink`/`buildArtifact`) → served config consumed browser-side by `engine/index.js` · **Category:** secret handling / architecture · **Confidence: Confirmed (exposure)**
- **Defect:** `applySink` writes `webhookUrl`/`sheetsEndpoint` into the config `buildArtifact` returns as the
  *served* config; lead delivery is **browser-side**. Zapier/Make/GHL inbound webhooks routinely carry a secret
  token in the URL.
- **Failure scenario:** tenant sets `webhookUrl=https://hooks.zapier.com/hooks/catch/123456/abcSECRETdef/`; that
  URL is in the hosted config JSON, visible in any visitor's DevTools; a visitor forges leads into the CRM
  forever; the token can't be rotated silently (baked into every copy).
- **Fix direction — documentation is NOT an acceptable fix; the architecture is wrong.** In a browser-delivered
  model the secret was **never secret** — anyone who sees one request can forge leads regardless of whether the
  token is "hidden," because the *endpoint itself* is exposed as long as the browser calls it. The correct design:
  **leads are a server responsibility** — the client POSTs to *our* endpoint, and the server re-sends to the
  tenant sink with the secret. **Its own risks (must be built in):** that new endpoint needs **rate-limiting +
  auth + origin validation**, or it becomes a spam relay into tenant CRMs. **Why "document it" is rejected:**
  telling a merchant "accept that your CRM endpoint is world-writable" makes the eventual pollution *our* fault —
  we knew and downgraded it to a footnote. **Gate before the first real merchant.**

### MEDIUM findings (condensed)

| ID | File:line | Category · Confidence | Defect & failure scenario (short) | Fix direction |
|----|-----------|----------------------|-----------------------------------|---------------|
| MED-1 | `engine/resultRenderer.js:380` | correctness / crash · **Reproduced** (reclassified High→Med by measurement) | `recs` is undefined (local is `built`); the else runs on the **non-decision** path. `{scoring.mode:"weighted-multi", resultLayout:"commerce", decisiveResult:true}` → `ReferenceError` at render (reproduced; `validateConfig` accepts it as valid). **Measured:** `mount(mountEl, renderResult(...))` evaluates `renderResult` first → it throws *before* `mount`, so **no partial DOM** (clean blank, not a half-card); and the certificate chokepoint doesn't apply to non-decision funnels (not a ق21 breach). Reachable-to-publish via review.html (SYS-1), so not purely theoretical. | Point the else at `built`, guard `built===null → []`; add a `commerce + non-decision + decisiveResult` render test; add the invariant "an exception in render cannot produce a partial render" (already upheld here — pin it). |
| MED-2 | `engine/validateConfig.js` / `_schema.json:99,42,184` | schema-as-contract · Confirmed | A `decision-table` config with no `decisionTable`/`signals` passes `validateConfig` (reproduced `valid:true`); non-string `themeVars` passes. The authoring brain is told the schema is the executable contract, but it has holes where decision-table funnels live. (Empty table is likely caught later by the publish gate; the real defect is the *contract* hole.) | Encode the conditional requirement + `additionalProperties`, or downgrade the "executable contract" claim in KNOWN-GAPS. |
| MED-3 | `resultRenderer.js:48,94` vs `_schema.json:243-247,159-179` | docs/schema drift · Confirmed | Renderer reads `config.copy.result` (all 4 configs) + `archetype…tagline` (freelancex/asq), neither in schema → a typo passes validation silently, UI degrades with no error. | Add `copy.result` + archetype `tagline` to the schema. |
| MED-4 | `authoring/ingest/robots.js:23-32,100-115` | ReDoS/DoS · Plausible | Each fetched `robots.txt` line → a fresh `RegExp` (`*`→`.*`), recompiled per rule per call, no caps. A hostile `robots.txt` (`/a*a*a*…`) + long candidate paths stalls the ingest worker (CPU DoS). | Cap pattern length + `*`/rule counts; precompile once; prefer a linear matcher. |
| MED-5 | `authoring/ingest/fetcher.js:156,174` | SSRF (TOCTOU) · Plausible | Validated resolution ≠ connected IP (no socket pinning). Folded into CRIT-1's full fix. | Socket-pin (see CRIT-1). |
| MED-6 | `authoring/ingest/fetcher.js:69` | SSRF (latent footgun) · Plausible | `lookup = opts.lookup || (opts.fetch ? null : defaultLookup)` — a future caller wrapping `fetch` without `lookup` silently disables the whole rebinding defense. | Default `lookup` to `defaultLookup` in Node regardless of injected `fetch`; tests inject a stub. |
| MED-7 | `engine/trustValidate.js`, `authoring/author/qualityGate.js` | vacuous invariant · Confirmed | No non-empty floor: `trustValidate({}).ok===true`, `antiBlandCheck({}).ok===true`. Masked on the server by `verifyFunnel`; exposed on the review.html path (SYS-1). Unpinned. | Add a floor (zero swept COMMERCE cells / zero results ⇒ blocker). |
| MED-8 | `authoring/author/qualityGate.js:26` | spec-vs-code · Confirmed | `DOMINANCE_MAX=0.5` under-enforces the binding ">40%"; the reference funnel itself sits at 41%. OS-4: spec wins → code and binding doc disagree. | Operator ruling as an ADR: ratify 50% (amend the standard) or fix the reference router to ≤40% and tighten. |
| MED-9 | `platform/publish.js:13`, `studio.js:159` | artifact reuse (9e) · Plausible | `funnelId = safeFunnelId(tenant + (config.id||"funnel"))` — two funnels missing `config.id` collide → the second overwrites the first's hosted artifact. | Unique id (uuid/content hash); refuse reuse without an explicit new version. |
| MED-10 | `analytics/auditQueue.js`, `engine/leadQueue.js` | honest-failure / docs · Confirmed | "A lead is never lost" is overstated — the buffer is the *visitor's* `localStorage`; if all sinks fail and they leave, it's lost (the visitor *does* see an honest error). | Downgrade the comment; the server-side lead endpoint (HIGH-3) gives durable capture. |
| MED-11 | `tests/contract.pipeline.e2e.test.mjs:12` | test-coverage-vs-claims · Confirmed | The only orphaned `*.test.mjs` (1 of 109); asserts the **BINDING** certified-pipeline contract, honestly known-red, but **not in KNOWN-GAPS** → the binding contract has zero green CI enforcement. | Record in KNOWN-GAPS as an un-enforced binding contract; wire when the brain→compiler→kernel chain lands. |

### GUARDRAIL (verified NOT a live vulnerability — corrects the review's XSS escalation)
- **Future single-file / inline exporter must JSON-escape `<` before any config JSON enters a `<script>`.**
  The review floated stored-XSS from scraped `name`/`description` as a second Critical. **Verified not
  exploitable today:** (a) the runtime renders every scraped string via `el({text})` = `textContent`
  (PoC: `</script><img onerror>` stored as text, 0 elements injected; `javascript:` href blocked by
  `safeHref`); (b) `engine/` has **zero `innerHTML`** of dynamic data (the two `innerHTML` sites in
  `embed/funnel.html` are static Arabic error strings); (c) config is **fetched and `JSON.parse`d**, never
  inlined into a script tag — and **no single-file/inline exporter exists in the tree**. So there is no sink
  to exploit. It becomes **Critical the instant** a single-file/inline output (planned in
  `PRODUCT_DECISIONS.md`) is built without escaping — because that ships on the *merchant's* domain (session
  theft against their customers). Treat as a **mandatory pre-condition** on that future exporter, tested with
  a `</script>`-in-description fixture. *(This is the value of PoC over consensus: seven reviewers + the review
  escalated it; the script shows the sink doesn't exist yet.)*

### LOW / NIT (verified, non-blocking — grouped)
- **Docs drift (Confirmed):** `README.md:68` + `ci.yml:21-22` "zero dependencies / no lockfile" — false
  (`@netlify/blobs`, `package-lock.json`, imported at `blobStore.js:24`; the *tests* are dep-free, the
  *platform* isn't; ADR-0004 correctly carves this out — not in drift). · `README.md:49-59` stale ("14 test
  suites", stages ⬜) vs ~99 suites / stages 1–3 substantially done.
- **Orphaned guards (Confirmed):** `tests/brain.structural.guard.mjs`, `brain.corpus.baseline.mjs` — neither
  chained nor imported → rot silently.
- **Authoring correctness (mostly latent / brain not yet wired):** `axisRoles.js:31` `validateCeiling` uses
  first-listed price not the min the bands were built on → wrong `role_validated` flag · `decisionTree.js:80-84`
  `stepPrice` iterates hardcoded `BANDS` → duplicate-candidate options on an empty tertile · `index.js:284-288`
  advisory axes emitted `required:true` though the copy says "optional" · `depthCalibration.js:46` counts
  `p.tags` despite its docstring excluding them (inert — no `tags` field today).
- **Nits (Confirmed):** `metrics.js:30-31` `disclosureRendering` tautologically `1.0` (measurement only) ·
  `_schema.json:3,5` stale `$id` + "placeholder" language · `hash.js:67` doesn't sort `variant.attributes` keys
  (over-triggers a cache miss, never a hash hole) · `webhook-sink.js` no SSRF check (browser-side, `no-cors`
  opaque → low; folded into HIGH-3's server redesign) · two `isProd()` defs (mitigated by an edge re-check) ·
  `studio.js:39` `refine` fallback runs `verifyFunnel` without `axisSet` (skips oracle criteria 4-6) when
  `a.meta.verify` absent · placeholder `sheetsEndpoint` in 2 reference configs (safe — reference-only).
- **Confirmed-benign (documented so a refactor doesn't wake it):** prototype-pollution surface in
  `skuLedger/shopify/catalog` non-exploitable today (no deep-merge; string `__proto__` is a no-op) · a
  `price`-typed constraint would relax unboundedly (`DEFAULT_BOUNDS.maxPriceOvershoot=null`) but no authoring
  path emits a `price` axis today.

---

## 2.5 Recommended fix ordering (operator-directed)

1. **Before any scrape of a site you don't own (incl. the first self-service merchant):** CRIT-1 in full —
   parsing gate + socket-pinning + per-hop redirect re-validation + IPv6 forms + **block IP literals / require a
   public registrable domain.** Until then, keep ingestion on `oudfactory` and operator-entered shops only.
2. **Immediately, regardless of scheduling:** SYS-1 — one `publishGate` + a CI invariant that no path reaches
   "ready/published" without it. This closes HIGH-2 and stops the 7th recurrence.
3. **Before any publish / embed (the "first real merchant" gates):** the XSS guardrail on the single-file
   exporter (must precede shipping that format) · HIGH-3 (server-side lead responsibility) · HIGH-1 (advisory
   values no longer rendered as verified provision).
4. **Measure, then classify — already done here:** MED-1 (render crash) measured → Medium.
5. **Safely deferred:** the remaining Medium/Low and any UI polish.
6. **Parallel work (no conflict):** the 4-b tree rebuild does not touch ingestion or publish; continue it in
   parallel **provided** ingestion stays on owned/entered catalogs until CRIT-1 is closed.

## 3. Coverage & limits

### Work-list & final status
| Unit | Status |
|------|--------|
| `engine/kernel/*` (decision core + oracle) · `engine/*` (decide, resolver, recommend, scoring, signals, resultRenderer, state, flow) | **Reviewed** |
| gates: `engine/trustValidate.js` · `validateConfig.js` · `kernel/verifyFunnel.js` · `verificationReport.js` · `pipelineTypes.js` · `author/qualityGate.js` | **Reviewed** |
| `configs/*` (+ `_schema.json`, `_classification.json`) · `config/policy.json` · `platform/configSource.js` · `tenantStore.js` | **Reviewed** (each config individually) |
| `authoring/ingest/*` · `authoring/brand/extractBrand.js` | **Reviewed**; `authoring/ingest/report.js` **skipped** (low-risk formatter, out of slice) |
| `authoring/brain/*` · `brain2/*` · `author/*` · `ai/*` · `quality/*` | **Reviewed** |
| `analytics/*` · lead sinks (`engine/lead*`) · `platform/*` · `netlify/functions/*` · `embed/*` | **Reviewed** |
| `integrations/` | **N-A** — no `.js` files (empty); if integrations are expected here, that absence is itself a gap to confirm. |
| `tests/*` (109) | **Reviewed** (orphan analysis complete over all 109; 7 read in full; ~92 sampled by assertion-count heuristic — a heuristic proves each file *has* assertions, not that each is non-vacuous). |
| `docs/adr/*` · `docs/standards/*` · `README` · `CLAUDE.md` · `KNOWN-GAPS.md` · `ci.yml` | **Reviewed** (key docs in full; ADRs spot-checked vs code) |
| `themes/` · `styles/` · `templates/` | **N-A** (asset templates) · `examples/*` **Skipped** (static demos) |

### Assumptions & what needs human / execution confirmation
- **HIGH-1** reaches a shopper only when the `enrichAuthor` AI-inference path is enabled for a live client (code
  defect Confirmed; shopper-facing reach Plausible).
- **KNOWN-GAPS numbers** (GAP-3/4/5/6, e.g. "13 of 85 SKUs") were read, not re-counted — Plausible-unverified.
- **Reviewers were static** (Read/Grep/Glob only; no execution). The main session **reproduced** CRIT-1, MED-1,
  MED-2, HIGH-2's data-flow, and the runtime-XSS-safety PoC with throwaway scripts (never committed).
- **Methodology (why this report is short):** discover → verify → reverse-check → drop anything a green test
  already covers → **and prefer a PoC to consensus.** The two corrections in v2 (XSS down, render-crash down)
  came precisely from replacing seven-reviewer agreement with a script; treat any remaining **Plausible** item
  the same way before acting on it.

## 4. Appendix

### npm audit (@ 0d356fa)
```
vulnerabilities: info 0 · low 0 · moderate 0 · high 0 · critical 0 · total 0
prod dependencies: 1 (@netlify/blobs ^8.0.0) · dev 0 · no postinstall scripts declared
```
Low (awareness): caret range on the single prod dep; `package-lock.json` pins the resolved version (CI reproducible).

### /security-review
**Not run as a separate pass — stated limitation, not a hidden gap.** It reviews a *diff* (here, effectively the
whole recent codebase) and only the security dimension; two dedicated **full-tree** security reviewers (ingestion
+ integrations/platform) covered it with file-level tracing, and the top security finding (CRIT-1) was
**reproduced** here — a stronger signal than a diff scan. Runnable on demand against a specific future diff.

### Fan-out
Seven read-only `ftd-critic` reviewers (Read/Grep/Glob only): decision-engine core · trust/anti-bland/verify
gates · config+schema · ingestion security · authoring brain+oracle · integrations/lead-sinks/platform · tests+docs.
Each returned only its slice's verified problems; the main session re-verified the severe items (reproducing the
top ones) and assembled this ranked report. **v2** adds SYS-1 and the two measured reclassifications after a
post-report review.
