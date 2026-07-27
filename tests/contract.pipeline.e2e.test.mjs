/**
 * tests/contract.pipeline.e2e.test.mjs — STEP 2 (ADR-0043 / certified-pipeline-contract). RED-FIRST.
 * -------------------------------------------------------------------------------------------------
 * Drives the REAL production entry (generateFunnelFromUrl → recordFrom, exactly what the Netlify
 * generate-background handler runs) end-to-end on a FROZEN-GOLD fixture (recorded oudfactory), then
 * asserts the CERTIFIED-PIPELINE CONTRACT stamps on the served artifact + the certified path:
 *     artifact_kind === "CERTIFIED_ARTIFACT" · compiler_version · kernel_version · brain_version ·
 *     path_certified === true
 * The OLD authoring (Stage-2, live today) emits a plain config with NONE of these, so this MUST FAIL
 * NOW — for a NAMED contract reason, not "file missing". It goes green ONLY when the new chain
 * (brain → structural compiler → kernel certifier → publish CertifiedArtifact) is wired. It is
 * deliberately NOT in `npm test` until then (a known-red contract), and is run standalone.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
const { generateFunnelFromUrl } = await import("../authoring/index.js");
const { recordFrom } = await import("../platform/jobs/generateJob.js");
const { score } = await import("../engine/scoring.js");
const { resolve } = await import("../engine/resolver.js");
const { certifyForRender, isCertified, clientVersionsOf } = await import("../engine/kernel/certifyForRender.js");

const FIX = fs.readFileSync(new URL("./fixtures/oudfactory.products.json", import.meta.url), "utf8");
const fetcher = { userAgent: "contract", setMinDelay() {}, stats: () => ({ requests: 0, maxPages: 200, minDelayMs: 0 }),
  async get(u) { if (u.endsWith("/robots.txt")) return { ok: false, url: u, reason: "404" };
    if (u.includes("/products.json")) { const p1 = !/[?&]page=([2-9]|\d\d+)/.test(u); return { ok: true, url: u, finalUrl: u, status: 200, text: p1 ? FIX : '{"products":[]}' }; }
    return { ok: true, url: u, finalUrl: u, status: 200, text: "<html></html>" }; } };

const reasons = [];
function contractCheck(name, cond, namedReason) { if (!cond) reasons.push(namedReason); console.log(`  ${cond ? "✓" : "✗"} ${name}${cond ? "" : "  → " + namedReason}`); }

// ── the REAL production entry (what generate-background calls) ──
const res = await generateFunnelFromUrl("https://www.oudfactory.com", { authorized: true, fetcher, currency: "AED" });
const served = res.ok ? recordFrom(res, "https://www.oudfactory.com") : { status: "error" };
const cfg = (served && served.config) || {};

console.log("\nCONTRACT E2E — production entry → served artifact → certified path\n");
// NAMED contract reasons (the operator's list) — checked against what the live path actually emits:
contractCheck("artifact carries artifact_kind === CERTIFIED_ARTIFACT",
  cfg.artifact_kind === "CERTIFIED_ARTIFACT", `artifact_kind ≠ CERTIFIED_ARTIFACT (got ${JSON.stringify(cfg.artifact_kind)})`);
contractCheck("artifact carries compiler_version",
  cfg.compiler_version != null, "missing compiler_version (no structural compiler in the production path)");
contractCheck("artifact carries kernel_version",
  cfg.kernel_version != null, "missing kernel_version (artifact not minted by the kernel certifier)");
contractCheck("artifact carries brain_version",
  cfg.brain_version != null, "missing brain_version (production path does not consume authoring/brain/*)");

// path_certified: drive one real answer-path through the certificate
let path_certified = false;
if (cfg.decisionTable) {
  const rule = cfg.decisionTable.find((r) => r.kind === "COMMERCE");
  if (rule) {
    const answers = {};
    for (const q of cfg.questions || []) { const sig = (cfg.signals || []).find((s) => s.source === q.id); const ds = (cfg.derivedSignals || []).find((d) => d.from.includes(sig?.id)); const want = ds && rule.when[ds.id]; answers[q.id] = Object.keys(sig?.map || {}).find((k) => sig.map[k] === want) || (q.options[0] || {}).id; }
    const cert = certifyForRender(cfg, resolve(score(cfg, answers), cfg), answers, clientVersionsOf(cfg));
    path_certified = isCertified(cert) && cert.kernel_version != null && cert.compiler_version != null;
  }
}
contractCheck("a certified path yields a SelectionResult stamped with kernel_version + compiler_version",
  path_certified, "path_certified = false (the certified SelectionResult carries no kernel_version/compiler_version stamps)");

console.log("\n" + (reasons.length ? `RED (as required now) — contract not yet satisfied. Named reasons:\n  - ${reasons.join("\n  - ")}` : "GREEN — the certified pipeline contract holds end-to-end."));
// This assertion is EXPECTED to throw until the new chain lands (kept out of npm test until then).
assert.equal(reasons.length, 0, "certified-pipeline contract unsatisfied: " + reasons.join(" | "));
