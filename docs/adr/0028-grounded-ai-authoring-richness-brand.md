# ADR-0028 — Grounded AI authoring + richness gate + brand auto-styling (the moat)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Scope:** Close the generation-quality gap the operator found (auto-funnel vs a hand-built
  reference for the same store). Three separate tracks, all preview-only; the live site is
  untouched. Builds on Stage 2 authoring (ADR-0015/0017/0018), the anti-bland gate
  (ADR-0016), and the Netlify generate function (ADR-0027).

## Context

The operator compared our auto-generated oudfactory funnel to a funnel they hand-built for
the same store and found a real, independently-verified gap:

| | Hand-built reference | Our generator |
|---|---|---|
| Questions | 7 (wear-style, intent, occasion, sillage, character, expertise, budget) | 2 (budget, type) |
| Catalog coverage | broad | 6 of 51 = 12% |
| Brand identity | store logo + warm palette | generic "platform-clean" |
| Result | match-% cards | one decisive pick |

**Root cause (confirmed against the real Shopify catalog):** oudfactory's *structured* data
exposes only ~2 dimensions (6 coarse `product_type`s + a price range). Our axis-miner mines
only what's in the data → 2 questions. The reference's rich dimensions (occasion, sillage,
character, expertise) come from **human category knowledge that isn't in the catalog at
all.** Two more gaps: the trust gate catches a *dead* funnel but not a *thin* one, and we do
no brand styling.

## Decision — two layers, kept strictly separate

**Authoring (design-time, once per store): add intelligence.** Use the Anthropic Claude API
**server-side, inside the Netlify generate function** (the key is a server secret, never in
the browser). The model reads the real catalog and proposes rich, category-appropriate
decision dimensions → questions → answer→product mapping, like a domain expert. Default
model **`claude-sonnet-5`** (operator-specified for the design step); prompt caching on the
stable system prompt to keep cost down; the design is **cached per store URL** so we never
re-call for the same store.

**Runtime (per visitor): stays 100% deterministic.** No LLM per visitor. Scoring and
rendering are unchanged — the LLM's output is compiled into the *same* engine `config` the
deterministic path produces, and the runtime just runs it.

### Non-negotiable guardrails (this is what keeps the moat honest)

- **No fabrication.** Every result must still map to a **real SKU with a real URL from the
  provided catalog.** The LLM's output is validated by `trustValidate` **+** `antiBlandCheck`
  **+** the new richness gate. Any recommendation whose URL isn't in the real catalog is
  dropped; a proposed question that is dead/mirror or a result that is ungrounded → **reject
  and repair/regenerate, never ship.** The gates are never weakened.
- **Honest failure / fallback.** If the LLM call fails (no key, network, refusal, or output
  that can't be made to pass the gates after N repair attempts) → **fall back to the
  deterministic generator** (thin but honest) or surface an honest failure. Never fake
  richness.

### Track A — Richness gate (deterministic, no LLM)

`authoring/quality/richnessCheck.js`: reject a generated funnel that is **too thin *when the
catalog justifies more*** — fewer than ~4 questions, or catalog coverage below a floor, on a
catalog large enough to support depth. A small catalog that honestly supports only 2
questions still passes (anti-bland wins — we never pad). **Teeth:** a synthetic *thin* funnel
on a *rich* catalog must be rejected; a rich funnel must pass; a thin funnel on a *small*
catalog passes ("a gate that can't fail is theater"). This gate is the trigger that tells the
authoring layer "this catalog deserves the AI-enrichment path."

### Track B — Brand auto-styling (deterministic, no LLM)

`authoring/brand/extractBrand.js`: from the already-ingested site HTML, extract the store's
**logo** (`og:image` / `apple-touch-icon` / `<link rel=icon>` / a logo `<img>`) and **colour
palette** (`<meta name=theme-color>`, CSS custom properties, and the most frequent brand hex
values), producing a `{logo, colors:{primary,accent,bg,text}}` profile. Authoring attaches it
as `config.brand.logo` + `config.themeVars`; the engine applies `themeVars` as `:root` CSS
custom-property overrides so the funnel **visually matches the store** like the reference —
opinionated defaults **+ a few safe brand overrides** (UX_INTERFACE_DECISION), never a
free-form theme editor.

### Track C — AI-enriched authoring (Option B)

`authoring/ai/enrichAuthor.js` (pure; the model call is **injected** so the whole loop runs
offline in tests, exactly like ingest/author):

1. Build a prompt: **system** = the binding design standard (Results-First, ask facts /
   derive the product, no fabrication, 3–5 questions, decisive result, every result maps to a
   REAL sku from the supplied list) — cached; **user** = the real catalog (structured) + the
   business goal + brand.
2. Call the model with **structured outputs** (`output_config.format` json_schema) → a funnel
   *design*: rich axes → questions → archetypes, each recommendation referencing a **catalog
   URL**.
3. **Compile** the design into an engine `config` (decision-table, `decisiveResult:true`) and
   **validate against the real catalog** — drop any recommendation whose URL isn't a real
   product; then run trust + anti-bland + richness.
4. **Repair loop:** on any gate failure, feed the findings back for one repair pass; cap
   attempts; on exhaustion return `{ok:false}` so the caller falls back to deterministic.

Target for a catalog like oudfactory: **~5–7 real category dimensions, broad coverage** (a
large fraction of the 51 reachable across paths), optional match-% cards + a WhatsApp/phone
lead field to match the reference's feature set.

### Runtime transport (why raw HTTPS, not the SDK)

The default model call uses **raw HTTPS `fetch`** to the Messages API (Node 18+ global fetch
on Netlify), not the `@anthropic-ai/sdk`, to keep this **zero-dependency** repo dependency-free
(`npm test` needs no install) and consistent with its injected-transport testing discipline —
the pure enrichment logic + gates are fully unit-tested with an injected `complete`, and only
the thin runtime wrapper touches the network. Request shape: `model: "claude-sonnet-5"`,
`system` with `cache_control` (prompt caching), `output_config.format` json_schema (guaranteed
JSON), non-streaming (single design, `max_tokens` well under the timeout). Honest failure on
any non-200 / refusal.

## Consequences

- Auto-generated funnels can now rival a hand-built one — rich dimensions, broad coverage,
  brand-matched — **without ever fabricating** (every result is a real SKU; the gates enforce
  it) and **without an LLM per visitor** (design-time only, cached per store).
- The richness gate gives the trust/anti-bland gate the missing "too thin" tooth, and doubles
  as the signal to escalate to AI enrichment.
- **Operator step for live proof:** the preview's generate function uses AI enrichment only
  when `ANTHROPIC_API_KEY` is set on the Netlify site (a server secret). Until then it falls
  back to the deterministic path — honestly. Everything here is proven offline with injected
  completions; the live oudfactory regeneration runs once the key is set.
