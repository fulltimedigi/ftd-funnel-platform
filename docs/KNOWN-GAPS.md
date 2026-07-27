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

## GAP-2 — ق21 (no render without a certificate) is PARTIAL for legacy reference configs

- **Law (constitution ق21):** the result page renders only from a minted certificate; the CTA lives
  inside it; NO_MATCH/STALE/UNVERIFIED are typed states.
- **State: enforced for authored funnels; not for legacy reference configs.** Every funnel from the
  authoring pipeline is kernel-authored (`isKernelAuthored` true) and renders through
  `certifyForRender` (fail-closed). The shipped `configs/` reference/demo funnels carry no proofs, so
  `isKernelAuthored` is false and they render on the legacy no-certificate path.
- **Containment (ADR-0041):** those configs are classified **reference-only / non-publishable**
  (`configs/_classification.json`) and the classification is enforced live
  (`tests/reference-classification.test.mjs`) — a new proofless COMMERCE config is a RED, so the gap
  cannot silently grow. Merchant funnels ship only through authoring (gated).
- **What it takes to fully close:** the serve-path cert mandate (make `renderResult` consume only a
  certificate for every layout, retiring the legacy path) — a later, deliberate step; a hand-authored
  merchant config makes it mandatory (ADR-0041 forward rule).
- **Tracked in:** ADR-0041; the classification invariant keeps it from widening.
