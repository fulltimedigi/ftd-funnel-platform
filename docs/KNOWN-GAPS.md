# KNOWN GAPS — enforcement gaps that are VISIBLE by design

A binding rule that **cannot currently be enforced** must be visible here, never buried in a comment or
silently "deferred". Each entry states the law, why it can't be enforced yet, what it would take, and
where it's tracked. Reviewed whenever the deploy shape or the render path changes.

---

## GAP-1 — ق17 (versioning / staleness) is STRUCTURALLY UNENFORCEABLE in the current deploy

- **Law (constitution ق17):** a decision certificate minted against one catalog / policy / answer-contract
  / locale snapshot must never be shown against a different one — any drift is **STALE**, no card.
- **State: present in code, but a structural no-op — NOT merely dormant.** The runtime check exists
  (`engine/kernel/verifyRuntime.js` version coherence → `engine/kernel/certifyForRender.js` `STALE`
  terminal), and the production entry passes client stamps
  (`engine/index.js`: `clientVersions = { catalog_version, policy_version, answer_contract_version,
  config_hash, locale_bundle_version }`). But in the current **single-artifact / embed** deploy those
  stamps are read from **the same served config**, so `clientVersions[k] === config[k]` **by
  construction** — the mismatch branch (`verifyRuntime.js`: `clientVersions[k] !== config[k]`) can
  never be true. The code comment says so explicitly ("these match by construction"). So STALE cannot
  fire on a real visitor today.
- **Consequence:** an embed/single-file funnel cached by a visitor after the merchant's catalog changed
  would **not** be detected as stale. This is a real freshness gap, bounded by the deploy shape.
- **What it takes to enforce:** a **split-artifact** deploy where the client's loaded version stamps
  come from a *different* source than the served config (e.g. a versioned config URL + an independent
  version endpoint / header), so drift is observable. Until that deploy exists, ق17 is disabled, not
  satisfied.
- **Do NOT:** fabricate a passing STALE check, or claim ق17 is "covered" because the code is present.
- **Tracked in:** ADR-0041; this gap is checked whenever the deploy/serve path changes.

## GAP-6 — a variant/size picker is N certificates per leaf, not a display feature

- **The finding (recorded now, before it is "discovered" later):** ق21 requires every CTA to come from a
  certificate. So if a result card offers 6 buyable sizes, **each buyable size needs its OWN certificate**
  (its own proven SKU + buy_url). A variant/size picker is therefore **N certificates per leaf**, not a
  presentation feature — it is N times the certification work.
- **Why it matters for ق2 (screen-level reachability):** today the leaf offers ONE variant and the
  visitor can reach+buy only ~13 of 85 SKUs (measured, Part-4A). Closing that is not a UI task; it is
  minting a Purchase Witness (certificate) per buyable variant on a reachable result.
- **Witness model (to be enforced by `NoActiveSKUWithoutAccountingOrWitness`, step 4):**
  - **Surface Witness** for every non-excluded SKU: `path_id · result_id · sku_id · surface_role ·
    variant_option` — proves the visitor **reaches it by walking published options**, not that it merely
    exists in the artifact.
  - **Purchase Witness** for every AVAILABLE SKU: `selection_result_id · buy_url · price · availability ·
    path_certified` — a CTA that comes from a kernel certificate.
  - Unavailable SKU: Surface Witness + an explicit no-active-CTA state (ق14).
- **Split (operator ruling):** the picker **UI** may be deferred; SKU **reachability** may NOT — the
  13/85 gap stays visible here until the witnesses are minted. The witness invariant **blocks wiring
  (publish/serve)**, not the measurement.

## GAP-3 — post-publish catalog DRIFT is not covered by the publish-time gate

- **The gap, stated plainly:** **التحقق وقت النشر لا يغطي انجراف الكتالوج بعد النشر؛ التحقق وقت العرض ما
  زال غير إلزامي لكل تخطيط.** (Publish-time verification does not cover catalog drift after publish;
  render-time verification is still not mandatory for every layout.)
- **State:** the per-funnel publish gate (ADR-0041) verifies proof coverage **at publish time**. The
  merchant's catalog then changes — a price moves, a variant sells out, a product is deleted. The
  storage-crossing E2E case C tested drift *at the same instant, before serve* (a post-publish edit
  applied then rendered immediately); it does **not** test a config that was gate-green days ago and is
  served after the catalog moved underneath it.
- **What partially covers it today:** the render-time verifier (`verifyServedResult` →
  `certifyForRender`) re-checks proof/SKU identity on the certificate path, so a *kernel-authored*
  funnel whose displayed product no longer matches the proof degrades to a terminal rather than a wrong
  card. Since ADR-0042 the certificate is mandatory for every decision funnel (GAP-2 closed), so this
  covers all catalog funnels; it still deliberately defers **live price/stock** checks
  (`verifyRuntime.js`), so a stale price on a still-valid SKU is not caught.
- **What it takes to close:** render-time (or near-real-time) re-validation mandatory for every layout,
  plus a freshness/webhook signal from the merchant catalog. Deferred by decision — but **visible here**.
- **Tracked in:** ADR-0041; revisit with the serve-path cert mandate (GAP-2) and the first published
  merchant.

## GAP-2 — ق21 (no render without a certificate): CLOSED for the `isKernelAuthored` backdoor (ADR-0042)

- **Was:** the certificate was mandatory only when `isKernelAuthored` — a config-classification flag,
  not a structural property. A decision funnel without proofs (the shipped reference configs) rendered
  a **config-composited** product card on the legacy path, with no certificate.
- **Closed:** `isKernelAuthored` is REMOVED. Any **decision-table** funnel MUST certify; an
  uncertified/proofless path renders an honest **terminal** (no product, no CTA). The standalone
  brand-home result CTA (`ctaLink`) is DELETED — the only result CTA is the certified product card's
  (`cert.cta_url`); no certificate → no CTA. Proven on a fixture MINTED from real authoring
  (`tests/ux.standard`, `tests/lib/mintedFunnel.mjs`) + poison canary (reintroducing the backdoor
  reddens the suite).
- **Consequence (recorded, NOT a regression):** the proofless reference configs
  (`pm-certification-advisor`, `houseplant-advisor`) now render a **terminal** instead of a product —
  because they carry no proofs. The `isKernelAuthored` backdoor was silently serving them; removing it
  is the fix, not a break. They keep their role as **design references** (questions / copy / flow).
- **REJECTED option (recorded with reason):** giving the reference configs real proofs — **rejected**:
  it would require real catalogs for houseplants and PM certifications that **do not exist**, so minting
  proofs would mean **fabricating catalog data** — a direct violation of the constitution's first rule
  (no fabrication). Certified render fixtures are therefore minted from the real oudfactory pipeline.
- **Remaining sub-gaps:** GAP-4 (non-catalog coaching recommendations) and GAP-5 (scoring/dominant
  funnels) — both outside the certificate mechanism, contained by "no product claim / no CTA", below.

## GAP-4 — non-catalog (coaching) recommendations have no certificate mechanism

- **The gap:** funnels like FreelanceX recommend a **coaching track / profile**, not a catalog product.
  The certificate mechanism is built on "a real catalog SKU with a real URL", so it **does not apply** —
  a **mechanism gap, not an exemption**: the promise principle (no result without grounding) still holds
  for these funnels, and there is currently no way to certify it.
- **Containment (enforced):** until the mechanism exists, a non-decision (coaching) funnel renders its
  recommendation **descriptively only — no catalog-product claim, no buy CTA, no brand-home CTA**
  (`renderTracks`/`renderPersonas`, `showCta:false`, `ctaLink` deleted). Enforced by `tests/asq` and
  `tests/funnel.freelancex` (a scoring/coaching result carries no CTA element of any kind).
- **What it takes to close:** a grounding/certificate mechanism for non-catalog recommendations.

## GAP-5 — scoring (dominant / weighted-multi) funnels are entirely outside the certificate mechanism

- **The gap:** the certificate mechanism is built for **decision-table** funnels. A `dominant` /
  `weighted-multi` funnel (e.g. `asq-perfume`) never reaches `certifyForRender`. That is a whole
  **class** of funnels outside the guarantee — a **mechanism gap, not an exemption**.
- **Containment (enforced):** a non-decision funnel makes **NO product claim and carries NO CTA**
  (`renderCommerce` draws a product only for a certificate; a non-decision funnel has none). Enforced by
  `tests/asq` (GAP-5: no signature, no price, no grid, no shop CTA, no CTA element). It is NOT allowed to
  render a product via any backdoor "because it's a different type".
- **What it takes to close:** extend the certificate mechanism to scoring funnels (or migrate catalog
  scoring funnels to decision-table).


## GAP-7 / GAP-6 — SKU-level reach + the size picker (ق20/ق4) — ✅ CLOSED / BUILT (round-12, ADR-0063)

> **RESOLVED 2026-07-28 (ADR-0063).** The deferred variant/size picker (GAP-6) is built at the data/certifier
> layer: one card per family + an in-card size picker (ق4 — size folded, never a card per size); every in-budget
> purchasable variant is a SELECTABLE option with its own certificate (`selection_result_id · buy_url · price ·
> availability · path_certified`); the default comes from the KERNEL (recorded reason), not a display rule;
> over-ceiling / unavailable sizes are shown labeled with no active CTA. Band matching moved to the VARIANT level
> with a ceiling (boundaries stay at the family level — the frozen fixture is untouched); `band_locked_out = 0`
> (no purchasable variant is design-locked-out). Result on oud: **SKU-level I3 = 80/80**, `not_arrived = []`,
> mint stays 100%. **PUBLISH is unblocked.** Remaining out of scope: the live render of the picker UI + wiring/
> delivery. The reopened SKU-level analysis (round-11) and the retracted family metric (round-10) are kept below.

<details><summary>Round-11 (ADR-0062, superseded): the family metric was blind — SKU-level I3 was 50/80</summary>

> **REOPENED 2026-07-28 (ADR-0062) — the round-10 "closed at 80/80" was a FAMILY metric, RETRACTED.** The
> family measure counted a family as accounted and credited ALL its variants, so `variant_unreachable = 0` was
> true *by construction*, not by measurement. Re-measured **per SKU** (each active SKU needs a Surface witness =
> individually selectable, AND a Purchase witness = a valid, in-budget, sku-specific CTA): on oud I3 is
> **50/80**, `not_arrived = 30` — all `variant_unreachable` (the extra sizes of the 11 multi-variant families;
> e.g. 5 of the `5-tola-wood-box`'s 6 sizes). **PUBLISH is BLOCKED.** The CTA guard was tightened from existence
> to validity (`validateCta`: resolves to a specific SKU in the shipped snapshot, satisfying the path's hard
> budget ceiling; a family url and an over-ceiling variant are rejected). The real fix is the **variant/size
> picker** (surface every in-budget variant as selectable, each with its own valid CTA) — deliberately not built
> yet. Proven red-first in `tests/certifier.gap7.test.mjs`. Mint rate stays 100% (equivalence unchanged; the gap
> is display reach, not the pick). The original (family-level) analysis is kept below for the record.

</details>

The full oracle-authored tree (4-b, ADR-0051) measures TWO reach numbers: `surface_reachable@cap`
(today's truth — a leaf surfaces `leaf_total_cap` SKUs) and `surface_reachable_with_expansion` (what the
ق20 oversized-leaf **comparison grid** would surface — every candidate in the leaf). On oudfactory they are
**~61/80 (76%)** vs **80/80 (100%)** — a **display commitment of ~19 SKUs**. Those are all `family_buried`
(beyond the leaf cap), **0 `variant_unreachable`**. The gap closes only when the oversized-leaf grid is built
in the render layer (untouched here); **`with_expansion` must NOT be claimed as achieved until then** — a
candidate is never *hidden* (it is in a leaf), only capped in the primary surface. Tracked as a render task.

**Upgraded to a PUBLISH BLOCKER (round-10, ADR-0058).** The control experiment (`tests/btree.control-random.test.mjs`)
showed `surface_reachable@cap` is **< 100% in every axis order** (oud 58–62/80; a worst-case fixture as low as
10/20) — i.e. **18–22 SKUs are not surfaced today, in all orderings**. That is a ق2 (reachability) shortfall
whose cause is **this missing grid, not the axis-ranking rule** (the frozen ranking even gives the *lowest*
surface on the worst-case). Therefore, exactly like the SKU-witness pattern: **a funnel that promises reach its
display cannot deliver is NOT PUBLISHED while GAP-7 is open — GAP-7 blocks PUBLISH, never measurement, and
never the freeze of the axis selector.** Tying the axis-selector's reopening to `surface_reachable@cap` is
**forbidden** (it would pressure tuning the ranking to compensate for a missing display layer). `surface@cap`
is a **regression baseline** only (`tests/btree.axis-selector-freeze.test.mjs`).
