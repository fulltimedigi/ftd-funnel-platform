# BINDING RULE — every guard begins by ENUMERATING its entry points

> Recorded after **four** repetitions of the same failure: a guard was written and tested, but the
> production path reached the guarded behavior through **another entrance** the guard didn't cover.
> The root cause was never a weak guard — it was **assuming a single entry point**.

## The four repetitions
1. The three guards (SAFETY / HANDOFF / METRICS) — defined, not wired onto the live path.
2. The brain tests — measured gold-*derived* data, not the real ingest pipeline's output.
3. The whole constraint kernel — built and correct, unreached by the live render path.
4. The publish gate — enforced on the async path (`runJob→recordFrom`) but **beside** the Studio
   path (`studio.publish` checked only trust+bland), which published proofless funnels while the
   review screen showed "ready".

## The rule (binding for every new guard, and retro-applied to existing guards)
1. **Enumerate first.** Before writing a guard, produce the explicit list of **every entry point that
   reaches the guarded behavior** — every code path that can render a result, persist a servable funnel,
   deliver a lead, etc. Never assume one entrance.
2. **Cover every entry.** The guard must sit on **all** enumerated entries, and ship with a
   **reachability test** that exercises **each** one (static wiring + behavioural) — like
   `tests/step1.publish-reachability.test.mjs`.
3. **Prove exemptions.** An entry claimed exempt (e.g. "this layout shows no product") must be proven
   exempt **by a check**, not asserted in prose.
4. **Poison-verify.** Neuter the guard and confirm the suite reddens, so the guard is known to bite.

## Retro-enumeration of existing guards (2026-07-27)
| Guard | Guarded behavior | Enumerated entry points | Reachability covered? |
|-------|------------------|-------------------------|-----------------------|
| Publish gate (proof coverage) | persisting/serving a funnel | `runJob→recordFrom`; `studio.generate/refine/publish→_gatesGreen` | ✅ `step1.publish-reachability` (both) |
| Render certificate (ق21) | drawing a product card / CTA | `renderResult → renderCommerce` (only, and only if `isKernelAuthored`) · `renderTracks` · `renderPersonas` | ❌ **GAP-2**: tracks/personas/legacy-commerce draw a product+CTA with NO certificate — the fix in progress |
| Trust + anti-bland | admitting a funnel to review/publish | `authoring/index` publish check; `studio.generate/refine` | ✅ enforced at both (studio gates; publish-time verify) |
| Ingest SSRF / robots | outbound catalog fetch | `ingestCatalog` (single entry via the polite fetcher) | ✅ single entry, tested |

The render-certificate row is exactly why GAP-2 is open: the guard covers one of three product-drawing
entries. Closing GAP-2 = putting the certificate on **every** layout that draws a product or CTA.
