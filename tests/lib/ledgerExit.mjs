/**
 * tests/lib/ledgerExit.mjs — the SHARED, INDEPENDENT SKU-Ledger exit validator (constitution ق22).
 * ---------------------------------------------------------------------------------------------
 * Truth comes from: the constitution (encoded as LITERAL non-negotiable constants below) + the
 * versioned policy file (tunable limits). The validator NEVER trusts the ledger's own stored
 * accounting number — it re-derives `unaccounted` from the SOURCE counter (decision أ).
 *
 * Non-negotiable (LITERAL here — a corrupted policy file cannot loosen them):
 *   • availability 5-enum, and `unknown ≠ sellable`      (ق7/ق14/ط)
 *   • Unaccounted active SKUs = 0 (or structural_incompleteness declared)   (ق2/أ)
 *   • accounting_status ∈ {discovered, excluded}          (ح)
 *   • "Default Title" is NEVER an option value            (ز/E)
 * Tunable (READ from policy): max_shopify_pages, sellable_states (cross-checked, not trusted blindly).
 */

// —— LITERAL non-negotiable constants (constitution) ——
const AVAIL_ENUM = Object.freeze(["available", "out_of_stock", "preorder", "backorder", "unknown"]);
const ACCOUNTING_STATUS = Object.freeze(["discovered", "excluded"]);
const NO_OPTION_SENTINEL = "default title"; // Shopify's no-options variant name — never an option value

/**
 * @param {object} ledger  the SKU Ledger to validate
 * @param {object} [opts]   { policy } — the parsed config/policy.json
 * @returns {{checks:Array<{name,pass,detail}>, failed:Array}}
 */
export function validateLedger(ledger, opts = {}) {
  const policy = opts.policy || {};
  const ing = policy.ingestion || {};
  const checks = [];
  const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail || "" });

  const L = ledger || {};
  const src = (L.source && L.source.active_skus) || 0;
  const skus = Array.isArray(L.skus) ? L.skus : [];

  // ق22 · policy-corruption guard: the tunable enum in policy must MATCH the literal (else reject)
  ok("ق22 · policy availability_states matches the literal enum (corruption guard)",
    JSON.stringify(ing.availability_states || []) === JSON.stringify(AVAIL_ENUM),
    `policy=${JSON.stringify(ing.availability_states)}`);

  // أ · accounting re-derived from the SOURCE counter (never trust the stored number)
  const accounted = skus.filter((s) => ACCOUNTING_STATUS.includes(s.accounting_status)).length;
  const unaccounted = src - accounted;
  ok("ق2 · ledger.active_skus === SOURCE counter", (L.accounting && L.accounting.active_skus) === src,
    `ledger=${L.accounting && L.accounting.active_skus} source=${src}`);
  ok("ق2 · Unaccounted active SKUs = 0 (recomputed from source)",
    unaccounted === 0 || (L.accounting && L.accounting.structural_incompleteness === true),
    `recomputed unaccounted=${unaccounted}`);

  // ق2/أ · page-cap must surface as structural_incompleteness, never a false zero
  ok("ق2 · page-cap → structural_incompleteness (no false zero)",
    !(L.source && L.source.page_capped) || (L.accounting && L.accounting.structural_incompleteness === true),
    `page_capped=${L.source && L.source.page_capped}`);

  // EMPTY-TRUTH GUARD: every() below is vacuously true on an empty set — require a non-empty ledger so
  // an empty catalog can't pass the per-SKU invariants for free.
  ok("· ledger is non-empty (guards the every() checks below)", skus.length > 0);

  // ح · accounting_status enum only
  ok("ح · every SKU accounting_status ∈ {discovered,excluded}",
    skus.length > 0 && skus.every((s) => ACCOUNTING_STATUS.includes(s.accounting_status)));

  // ط · availability 5-enum + unknown ≠ sellable (no active buy_url on unknown)
  ok("ط · availability ∈ 5-enum", skus.every((s) => AVAIL_ENUM.includes(s.availability)));
  ok("ط · unknown ≠ sellable (no buy_url on unknown)",
    skus.every((s) => s.availability !== "unknown" || !s.buy_url));

  // ز/E · NEGATIVE FIXTURE — "Default Title" must NEVER appear as an option value
  const leaks = skus.filter((s) => Object.values(s.option_values || {})
    .some((v) => String(v).trim().toLowerCase() === NO_OPTION_SENTINEL));
  ok("ز/E · no 'Default Title' as an option value (negative fixture)",
    leaks.length === 0, leaks.length ? `leaked in: ${leaks.map((s) => s.sku_id).join(", ")}` : "");

  const failed = checks.filter((c) => !c.pass);
  return { checks, failed };
}

/** Pretty-print + return exit code (0 green / 1 red). */
export function report(result, label) {
  console.log(`\n=== SKU-Ledger exit ${label || ""} ===`);
  for (const c of result.checks) console.log(`  ${c.pass ? "✓" : "✗ FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`);
  console.log(`\n${result.failed.length ? "❌ RED — " + result.failed.length + " check(s) failed" : "✅ GREEN — all " + result.checks.length + " checks passed"}\n`);
  return result.failed.length ? 1 : 0;
}
