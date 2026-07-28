# Codebase Audit — ftd-funnel-platform @ `0d356fa` · 2026-07-28 · Claude Code (claude-opus-4-8) · READ-ONLY

> **Frozen scope:** SHA `0d356fab955a2d91e38b7e5bc5e8de9e71193bc6`, whole repository, read-only. No code
> was modified in this audit — the deliverable is a verified-problem report; the owner decides fixes.
> **Governing rule:** a problem is listed ONLY with a concrete failure scenario (specific inputs → the
> exact wrong result/crash) that survived a reverse-verification pass. Every item carries a confidence
> label; the most severe were reproduced with throwaway scripts (run locally, never committed).

## 1. Executive summary

**Overall health: strong core, with one critical security hole and a cluster of trust-gate / honesty
gaps to close before the platform (authoring + publish + ingestion) is driven against real client sites.**
The deterministic decision core is genuinely solid — no runtime LLM or network on the hot path, a
mandatory render certificate (a product card is structurally unrepresentable without a kernel-minted
`SelectionResult`), honest `NO_MATCH → internal CTA`, deterministic tie-breaking, and the oracle's seven
invariants / clean-room / hash-completeness all held under adversarial tracing. `npm audit` is clean
(1 pinned prod dep, no postinstall).

**Launch-readiness:** the *respondent runtime* (a published funnel a visitor answers) is safe to ship —
its worst-case is an honest terminal, never a fabricated product. The **authoring + publish + ingestion
pipeline is not yet safe to run against untrusted/real sites**: it contains a Critical SSRF bypass and
several trust-gate divergences.

**Biggest risk:** `CRIT-1` — a DNS-rebinding SSRF bypass in the ingestion fetcher lets a malicious brand
site (or a redirect/sitemap it controls) read cloud-metadata credentials from our server. Reproduced.

**Counts:** Critical **1** · High **4** · Medium **10** · Low/Nit **~15**.

**Top 3 to fix first:**
1. **CRIT-1** — SSRF DNS-skip bypass in `authoring/ingest/fetcher.js:140` (reproduced → reaches `169.254.169.254`).
2. **HIGH-1** — the browser review screen tells the operator "ready to publish" via a weaker config-only
   check, bypassing the authoritative `verifyFunnel` gate (off-catalog / no-product funnels pass).
3. **HIGH-2** — tenant webhook/Sheets URLs (which for Zapier/Make/GHL carry a secret token) ship inside
   the public funnel config, visible in any visitor's browser.

---

## 2. Findings (most severe first)

### CRIT-1 · SSRF: DNS-rebinding guard skipped for any `0x…`-prefixed hostname
- **File:** `authoring/ingest/fetcher.js:140` · **Category:** untrusted-input security (SSRF) · **Confidence: Confirmed (reproduced)**
- **Defect:** `assertResolvesPublic()` is the only private-IP defense for a *real hostname* (the pure
  `assertUrlAllowed` returns "allowed" for any non-IP-literal host). To avoid double work on IP literals
  it short-circuits: `if (host.includes(":") || /^[0-9.]+$/.test(host) || /^0x/i.test(host)) return {ok:true}`.
  Those are **string-prefix heuristics, not "is this a literal IP already range-checked."** `0xdead.attacker.com`
  is a legal DNS name (labels may start with a digit + `x`), is **not** an IPv4 literal, yet matches
  `/^0x/i` → DNS resolution is skipped and the fetch proceeds to whatever the name resolves to.
- **Failure scenario (reproduced):** a fetcher given `http://0xdead.attacker.com/latest/meta-data/iam/security-credentials/`
  where the attacker's DNS answers `0xdead.attacker.com → 169.254.169.254`. Repro result: **`reachedFetch=true`**
  for the `0x` host, while control hosts `evilhost.attacker.com` and `1.2.3.4.5.attacker.com` were correctly
  blocked (`blocked-dns-private`). The server then reads cloud-metadata / internal-service responses.
- **Why it matters:** it defeats the exact ADR-0040 rebinding defense it sits inside, for the highest-value
  target (IAM creds). Reachable via a scope URL, a `302 Location:`, or a sitemap `<loc>` — all attacker-controlled.
  Ingestion's whole job is to fetch *untrusted* brand sites, so this is on the core use path.
- **Fix direction:** skip DNS only when the host is a confirmed literal already range-checked —
  `parseIPv4Any(host) != null || host.includes(":")` (IPv6) — never on string prefixes. Resolve+validate
  every other host, incl. `0x…`. Add a regression test with an injected `lookup` returning a private IP for a
  `0x`-hostname (`tests/ssrf.test.mjs` only covers `0x…` *IP literals*, so the suite misses this).

### HIGH-1 · The browser review screen publishes on a weaker gate than the authoritative `verifyFunnel`
- **Files:** `platform/review/review.html:271,199-204` + `platform/review/reviewModel.js:49-56,66` · **Category:** gate-bypass / vision-invariant (gate weakened) · **Confidence: Confirmed**
- **Defect:** `review.html` recomputes gates client-side and calls `buildReviewModel({config, trust, bland})`
  **without `verify`** (line 271); `buildReviewModel` then falls back to `_proofCoverage(config)` (reviewModel.js:66).
  `verifyFunnel` is **never called in review.html** (verified by grep). On `model.ok` the page calls
  `buildArtifact(...)` directly (line 204) — the same real embed-artifact builder — so the operator is handed a
  "ready to paste" snippet on the weaker signal. `_proofCoverage` only checks that `proof.product_id`/`match_state`
  *fields exist* — it cannot see the catalog and never runs the independent oracle.
- **Failure scenario:** a COMMERCE rule with `proof:{product_id:"https://not-in-catalog/x", match_state:"EXACT"}`.
  `trustValidate` (URL-string only), `antiBlandCheck`, and `_proofCoverage` (fields present) all pass →
  `model.ok===true` → operator is told "ready to publish" and gets an embed snippet. `verifyFunnel` would reject
  it (`unit … not in served catalog`).
- **Why it matters:** violates CLAUDE.md rule 4 ("never report success you can't confirm") and reviewModel's own
  promise. **Runtime mitigation (real):** the render reference-monitor (`certifyForRender`) still draws a *terminal*
  for an off-catalog/proofless path — so this is a **trust/honesty breach (operator misled), not a fabricated-card
  breach.** Ranked High, not Critical, for that reason.
- **Fix direction:** carry the server-computed `verifyFunnel` result to the review screen (the draft handoff
  already carries the config — carry `verify` beside it) and gate `buildArtifact` on it. See HIGH-1b for the
  `_proofCoverage` hardening that must accompany it.

### HIGH-1b · `_proofCoverage` reintroduces the zero-denominator vacuous-truth `verifyFunnel` closed
- **File:** `platform/review/reviewModel.js:55` · **Category:** vacuous invariant · **Confidence: Confirmed**
- **Defect:** `return { ok: commerce.length === 0 ? true : missing.length === 0 }`. A funnel with **zero COMMERCE
  rules** (empty `decisionTable`, or terminals-only) → `commerce=[]` → `ok:true` — exactly the ADR-0043 hole
  `verifyFunnel.js:138-139` fails explicitly (`renderable===0 → finding`). The `commerce.length===0` branch is
  untested (`platform.review.test.mjs:63` only covers a proofless-rule case).
- **Failure scenario:** a terminals-only / empty-table config passes trust + bland + `_proofCoverage` on the review
  screen and shows "ready" for a funnel that recommends no product on any path.
- **Fix direction:** a decision-table funnel with `commerce.length===0` must be `ok:false` ("must offer ≥1 proven
  product"), mirroring `verifyFunnel`.

### HIGH-2 · Tenant webhook / Sheets URL (with any embedded secret) ships in the public funnel config
- **Files:** `platform/publish.js:46-64` (`applySink`/`buildArtifact`) → served config consumed browser-side by `engine/index.js` · **Category:** secret handling · **Confidence: Confirmed (exposure); Plausible (that a given URL carries a secret)**
- **Defect:** `applySink` writes `sink.webhookUrl` into `config.leadForm.webhookUrl` and `sheetsEndpoint` into
  `config.analytics.sheetsEndpoint`, and `buildArtifact` returns that as the `config` served to every visitor; the
  lead POST is done **browser-side**. Zapier "Catch Hook", Make, and GHL inbound webhooks routinely embed a
  per-account secret token in the URL path.
- **Failure scenario:** tenant sets `webhookUrl = https://hooks.zapier.com/hooks/catch/123456/abcSECRETdef/`. That
  full URL sits in the hosted funnel config JSON, visible in any visitor's DevTools. A visitor can then POST forged
  leads into the tenant's CRM indefinitely; the secret can't be rotated silently (it's baked into every published copy).
- **Why it matters:** a real credential leak for exactly the integrations `PRODUCT_DECISIONS.md` targets.
- **Fix direction:** a product decision for the operator — (a) proxy webhook/Sheets delivery through a server
  function so the secret never reaches the browser, or (b) explicitly document that these URLs are public and warn
  tenants (in the Studio sink UI) to use signature-verifying receivers, not secret-in-URL ones.

### HIGH-3 · AI-inferred *advisory* values are rendered as definitive, grounded "the product provides it" reasons
- **Files:** `authoring/author/index.js:199-201` + `authoring/ai/enrichAuthor.js` (advisory axes marked `provenance:"ai-inference"`) · **Category:** vision-invariant (no fabrication, 9b) · **Confidence: Confirmed (code) / Plausible (reaches a shopper — needs the AI-enrichment path enabled)**
- **Defect:** `designToAxes` marks AI-guessed axes `advisory:true, provenance:"ai-inference"` and its own comment
  admits it "verifies FORM, not TRUTH." But `index.js:199` builds `carries` from `axisSet.map(...)` with **no
  `advisory` filter**, and line 201 pushes a `why` bullet `«اخترت ${label}، و«${name}» يوفّرها»` ("you chose X and
  «product» provides it") for **every** carried axis — including the unverified inferences.
- **Failure scenario:** the model infers `occasion=formal` from a product name; the result screen asserts, as a
  definitive grounded reason, that the product provides the shopper's chosen occasion — an unverified inference
  presented as fact. The gates miss it: the advisory axis *is* an asked signal, so `trustValidate` sees "claim
  resolves from an answer" and passes; anti-bland checks mirror/dominance, not truth-vs-form (the exact class
  CLAUDE.md warns the gates don't cover).
- **Why it matters:** working-rule #3 (no fabrication) is the platform's core promise. The *question* is hedged
  ("تفضيل اختياري") but the *reason* is not.
- **Fix direction:** for `provenance:"ai-inference"` axes, suppress the per-axis `why`/`whyNot` bullet or emit a
  disclosed/hedged form ("راعينا تفضيلك…") that never asserts verified provision. Add a test asserting no grounded
  "يوفّرها" bullet is emitted for an advisory axis.

### HIGH-4 · `recs` is undefined → `ReferenceError` crashes the result screen on a schema-valid config
- **File:** `engine/resultRenderer.js:380` · **Category:** correctness / crash · **Confidence: Confirmed (reproduced); reachability latent**
- **Defect:** in `renderCommerce`'s decisive-mode alternates line, `: (recs.contextual || []).slice(0, 3)` — there is
  no `recs` in scope (the local is `built`). The `else` runs whenever `cert` is falsy, i.e. the **non-decision**
  path (line 294: `cert = isDecision ? … : null`).
- **Failure scenario (reproduced):** a config `{scoring:{mode:"weighted-multi"}, resultLayout:"commerce",
  decisiveResult:true}` → `renderResult(...)` throws `ReferenceError: recs is not defined` (blank/blown result, no
  output). `validateConfig` accepts that config as `valid:true` (reproduced), and `_schema.json` allows
  `decisiveResult` on any funnel. Decision-table funnels never hit it (an uncertified cert returns a terminal
  earlier at line 295), which is why the green tests miss it — no test exercises *commerce + non-decision + decisive*.
- **Why it matters:** a hard crash on a schema-valid, hand-buildable retail scoring funnel. Latent against today's
  AI-authoring (which emits decision-table), so ranked at the bottom of High.
- **Fix direction:** point the else at the real local and guard the non-decision case (there `built===null`, so even
  `built.contextual` would throw) — fall back to `[]` when there's no `built`. Add a `commerce + non-decision +
  decisiveResult` render test.

### MEDIUM findings (condensed)

| ID | File:line | Category · Confidence | Defect & failure scenario (short) | Fix direction |
|----|-----------|----------------------|-----------------------------------|---------------|
| MED-1 | `engine/validateConfig.js` / `configs/_schema.json:99,42,184` | schema-as-contract · Confirmed | A `decision-table` config with **no** `decisionTable`/`signals` passes `validateConfig` (reproduced `valid:true`); a non-string `themeVars` passes (no `additionalProperties`). The authoring brain is told the schema is the executable contract, but it has holes exactly where decision-table funnels live. (Empty table is likely caught later by the publish gate's zero-denominator guard, so the real defect is the *contract* hole, not a shipped dead funnel.) | Encode the decision-table conditional-requirement (`if/then` or a hand check) + `additionalProperties`, or downgrade the "executable contract" claim and log in KNOWN-GAPS. |
| MED-2 | `engine/resultRenderer.js:48,94` vs `_schema.json:243-247,159-179` | docs/schema drift · Confirmed | The renderer reads `config.copy.result` (all 4 configs) and `archetype…primary.tagline` (freelancex/asq), neither in the schema → a typo (`copy.reslt`/`tagLine`) passes validation silently and the UI degrades with no error. | Add `copy.result` + archetype `tagline` to `_schema.json`. |
| MED-3 | `analytics/auditQueue.js`, `engine/leadQueue.js` | honest-failure / docs · Confirmed | Comments claim "a lead is never lost"; the audit ring + retry outbox are `localStorage` on the **visitor's** device. If every sink fails and the visitor leaves, the lead is lost (the visitor *does* see an honest error — no user deception). | Downgrade the comment to "buffered on this device"; add a server-side lead endpoint for durable at-least-once capture. |
| MED-4 | `platform/publish.js:13`, `studio.js:159` | artifact reuse (9e) · Plausible | `funnelId = safeFunnelId(tenant + (config.id || "funnel"))`. Two funnels under one tenant both missing `config.id` → identical published id → the second overwrites the first's hosted artifact at the same URL. | Append a DB uuid / content hash; refuse to reuse a published id without an explicit new version. |
| MED-5 | `authoring/ingest/robots.js:23-32,100-115` | ReDoS/DoS · Plausible | Each `Disallow`/`Allow` line from the fetched `robots.txt` becomes a fresh `RegExp` (`*`→`.*`), recompiled per rule per call, with no cap on pattern length / `*` count / rule count. A hostile `robots.txt` (`/a*a*a*…`) + long candidate paths stalls the ingest worker (CPU DoS). | Cap pattern length + `*` count + rule count; precompile once; prefer a linear matcher for the simple `*`/`$` grammar. |
| MED-6 | `authoring/ingest/fetcher.js:156,174` | SSRF (TOCTOU) · Plausible | Validated DNS resolution ≠ the IP `fetch` later connects to (no socket pinning); a ~0-TTL domain can answer public then private. Self-documented residual; lower likelihood than CRIT-1 (needs a race) but same asset. | Pin the connection to the validated IP (resolve once, connect by IP with Host preserved, or a vetting `lookup`/agent). |
| MED-7 | `authoring/ingest/fetcher.js:69` | SSRF (latent footgun) · Plausible | `lookup = opts.lookup || (opts.fetch ? null : defaultLookup)`: any future caller that wraps `fetch` without also passing `lookup` silently turns the entire rebinding defense off. Live path is safe today. | Default `lookup` to `defaultLookup` in Node regardless of injected `fetch`; have tests inject a stub `lookup`. |
| MED-8 | `engine/trustValidate.js`, `authoring/author/qualityGate.js` | vacuous invariant · Confirmed | Neither gate has a non-empty floor: `trustValidate({}).ok===true`, `antiBlandCheck({}).ok===true`. Masked on the server by `verifyFunnel`, but on the review.html path (HIGH-1, no `verifyFunnel`) all three config gates pass an empty/dead funnel at once. Unpinned by tests. | Add a floor — zero swept COMMERCE cells / zero results ⇒ blocker in each gate. |
| MED-9 | `authoring/author/qualityGate.js:26` | spec-vs-code · Confirmed | `DOMINANCE_MAX = 0.5` under-enforces the **binding** "no single-question dominance >40%" (constitution + CLAUDE.md). The reference funnel itself sits at 41%, so the gold bar violates the written rule. OS-4 says spec wins → code and binding doc disagree. | Operator ruling as an ADR: ratify 50% (and amend the standard) **or** fix the reference router to ≤40% and tighten the constant. |
| MED-10 | `tests/contract.pipeline.e2e.test.mjs:12` | test-coverage-vs-claims · Confirmed | The only `*.test.mjs` not wired into `npm test` (verified: 1 orphan of 109). It asserts the **BINDING** certified-pipeline contract end-to-end, is honestly known-red, but is **not listed in KNOWN-GAPS** → the binding contract has zero green CI enforcement and could be mistaken for "covered." | Record it in KNOWN-GAPS as an explicit un-enforced binding contract; wire it the moment the brain→compiler→kernel chain lands. |

### LOW / NIT (verified, non-blocking — grouped)
- **Docs drift (Confirmed):** `README.md:68` + `.github/workflows/ci.yml:21-22` claim "zero dependencies / no lockfile" — false (`@netlify/blobs ^8.0.0`, `package-lock.json`, imported at `blobStore.js:24`; the *tests* are dep-free, the *platform* isn't). ADR-0004 correctly carves this out and is **not** in drift. · `README.md:49-59` stale ("14 test suites (176 assertions)", stages ⬜) vs ~99 suites and stages 1–3 substantially done.
- **Orphaned guards (Confirmed):** `tests/brain.structural.guard.mjs`, `tests/brain.corpus.baseline.mjs` — substantive but neither chained nor imported → rot silently (contradicts the repo's own "a unit only the test imports = incomplete" rule).
- **Authoring correctness (mostly latent / brain not yet wired):** `axisRoles.js:31` `validateCeiling` uses first-listed price, not the min the bands were built on → a wrong `role_validated` flag (role itself unaffected) · `decisionTree.js:80-84` `stepPrice` iterates hardcoded `BANDS` not published bands → duplicate-candidate options for an empty tertile · `authoring/author/index.js:284-288` advisory axes emitted `required:true` though the copy says "optional" · `depthCalibration.js:46` counts `p.tags` despite its docstring excluding them (inert — no `tags` field today).
- **Measurement/nits (Confirmed):** `engine/kernel/metrics.js:30-31` `disclosureRendering` is tautologically always `1.0` (empty array truthy) — a quality metric that can never flag its gap (render reads disclosure from the certificate, not this metric) · `_schema.json:3,5` stale `$id` (`fulltimedigi-engine-v0`) + "placeholder/to-be-tightened" language contradicting the contract claim · `hash.js:67` doesn't sort `variant.attributes` keys (over-triggers a cache miss, never a "same-hash/diff-classification" hole) · `analytics/webhook-sink.js` no SSRF check on the tenant URL (browser-side, visitor's own LAN, `no-cors` opaque → low) · two `isProd()` definitions (`intakeModel.js:14` `NODE_ENV` vs `secrets.js:23-27` `CONTEXT`; mitigated by an explicit re-check at the internet edge) · `studio.js:39` `refine` fallback runs `verifyFunnel` without `axisSet` (skips the independent oracle criteria 4–6) when `a.meta.verify` is absent · placeholder `sheetsEndpoint` shipped in 2 reference configs (safe — reference-only).
- **Confirmed-benign (documented so a refactor doesn't wake it):** prototype-pollution surface in `skuLedger.js`/`shopify.js`/`catalog.js` exists but is non-exploitable today (no deep-merge; string `__proto__` is a no-op) · a `price`-typed constraint would relax unboundedly (`DEFAULT_BOUNDS.maxPriceOvershoot=null`) but no authoring path emits a `price` axis today.

---

## 3. Coverage & limits

### Work-list & final status
| Unit | Status |
|------|--------|
| `engine/kernel/*` (decision core + oracle) | **Reviewed** (engine-core + brain/oracle reviewers) |
| `engine/*` (decide, resolver, recommend, scoring, signals, resultRenderer, state, flow) | **Reviewed** |
| `engine/trustValidate.js` · `validateConfig.js` · `kernel/verifyFunnel.js` · `verificationReport.js` · `pipelineTypes.js` · `author/qualityGate.js` (gates) | **Reviewed** |
| `configs/*` (+ `_schema.json`, `_classification.json`) · `config/policy.json` · `platform/configSource.js` · `tenantStore.js` | **Reviewed** (every config file individually) |
| `authoring/ingest/*` · `authoring/brand/extractBrand.js` (untrusted ingestion) | **Reviewed**; `authoring/ingest/report.js` **skipped** (out of slice — low-risk formatter) |
| `authoring/brain/*` · `brain2/*` · `author/*` · `ai/*` · `quality/*` | **Reviewed** |
| `analytics/*` · lead sinks (`engine/lead*`) · `platform/*` (jobs, studio, publish, review, auth, secrets, tenant, intake, dashboard) · `netlify/functions/*` · `embed/*` | **Reviewed** |
| `integrations/` | **N-A** — directory contains **no `.js` files** (empty). If integrations are expected here, that absence is itself a gap to confirm. |
| `tests/*` (109 files) | **Reviewed (orphan analysis complete over all 109; 7 read in full; ~92 sampled by assertion-count heuristic)** |
| `docs/adr/*` · `docs/standards/*` · `README` · `CLAUDE.md` · `KNOWN-GAPS.md` · `ci.yml` | **Reviewed (key docs read in full; ADR set spot-checked against code)** |
| `themes/` · `styles/` · `templates/` | **N-A** — CSS/asset templates, no executable logic. |
| `examples/*` (static demo `index.html`) | **Skipped** — demo pages, not shipped runtime. See XSS residual below. |

### Assumptions & what needs human / execution confirmation
- **XSS residual (needs human confirm):** the runtime is XSS-safe (all scraped strings go through
  `textContent`/`safeHref`/`safeSrc`; `themeVars` are hex-whitelisted). **But** the single-file / embed
  **exporter** that inlines the config JSON (which carries raw scraped `name`/`description`) into an inline
  `<script>` was outside the reviewed slices — confirm it JSON-escapes `<` / `</script>` before it lands in a
  script tag, else scraped content reintroduces XSS.
- **HIGH-1 severity hinges on** whether `review.html`'s "get embed code" is a real delivery artifact or a throwaway
  preview (the page says "real and ready to paste" → treated as real). Confirm intended use.
- **HIGH-3 reaches a shopper only when** the `enrichAuthor` AI-inference path is enabled for a live client; the
  code defect is Confirmed, the shopper-facing reach is Plausible.
- **Not re-measured:** the quantitative KNOWN-GAPS numbers (GAP-3/4/5/6, e.g. "13 of 85 SKUs") were read, not
  re-counted against the catalog fixture — treat as Plausible-unverified.
- **Reviewers were static** (Read/Grep/Glob only — they physically could not modify the repo, and did not execute
  code). The main session reproduced CRIT-1, HIGH-4, MED-1, and HIGH-1's data-flow with throwaway scripts (never
  committed). Items labeled **Plausible** were reasoned, not executed, and want a human/execution confirm.
- **Methodology note:** volume was deliberately suppressed — each reviewer ran a discover → verify → reverse-check
  pass and matched findings against the green suite; findings a passing test already covered were downgraded to
  Solid. Only survivors are listed.

## 4. Appendix

### npm audit (@ 0d356fa)
```
vulnerabilities: info 0 · low 0 · moderate 0 · high 0 · critical 0 · total 0
prod dependencies: 1 (@netlify/blobs ^8.0.0) · dev 0 · no postinstall scripts declared
```
Low (supply-chain, awareness only): the single prod dep uses a caret range; `package-lock.json` pins the resolved
version, so CI is reproducible.

### /security-review
**Not run as a separate pass — stated limitation, not a hidden gap.** `/security-review` reviews a *diff* (not the
whole tree) and only the security dimension; on this branch the diff-vs-base is effectively the entire recent
codebase, which two dedicated **full-tree** security reviewers (ingestion + integrations/platform) already covered
with stronger, file-level tracing — and the top security finding (CRIT-1) was independently **reproduced** here. It
can be run on demand against a specific future diff; for whole-repo security coverage the subsystem reviewers +
`npm audit` are the backbone by design.

### Fan-out (reviewers, read-only)
Seven independent `ftd-critic` reviewers (Read/Grep/Glob only): decision-engine core · trust/anti-bland/verify
gates · config+schema · ingestion security · authoring brain+oracle · integrations/lead-sinks/platform · tests+docs.
Each returned only its slice's verified problems; the main session re-verified the severe items and assembled this
ranked report.
