/**
 * tests/brain.structural.guard.mjs — Part-2 structural guards (closure #6), RED-FIRST.
 * The evaluation corpus is a regression LOG, not proof of "results-first" — and its
 * format×budget×origin shape must NOT push the rebuild to pre-name axes. These guards fail if the
 * brain violates the constitution's discovery architecture. They are RED against the CURRENT brain
 * (pre-named format/budget axes) — that is the documented target the rebuild must turn green.
 * Standalone (not in npm test until the rebuild); no production code touched.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUTHOR = path.join(HERE, "..", "authoring", "author");
const checks = [];
const ok = (name, pass, detail) => checks.push({ name, pass: !!pass, detail: detail || "" });

// G1 — no hardcoded/pre-named axis modules (ق1/ق10: axes are DISCOVERED, never named up front)
const files = fs.readdirSync(AUTHOR);
const preNamed = files.filter(f => /Axis\.js$/.test(f)); // formatAxis.js, budgetAxis.js …
ok("G1 · no pre-named axis modules (formatAxis/budgetAxis/…)", preNamed.length === 0, preNamed.join(", ") || "none");

// G2 — no hardcoded axis-name literals injected as 'hard' before discovery
const idx = fs.readFileSync(path.join(AUTHOR, "index.js"), "utf8");
ok("G2 · no deriveFormatAxis/deriveBudgetAxis injection before the discovery graph",
  !/deriveFormatAxis|deriveBudgetAxis/.test(idx));

// G3 — the authoring pipeline builds an evidence-carrying discovery structure (candidate matrix /
// distinction graph) rather than a raw cartesian of pre-picked axes.
ok("G3 · discovery structure present (candidate matrix / distinction graph)",
  /candidateMatrix|distinctionGraph|axisContract|evidence_span/.test(idx));

// G4 — anti-axis-starvation: an axis with proven decisional relevance (evidence-backed origin in
// the gold set) may not be silently dropped. If the built brain has no origin question while the
// gold has ≥1 evidence-backed origin, that drop MUST be recorded in the decision-record (not silent).
// Documented target for the rebuild; enforced once the new brain emits its published-axes list.
ok("G4 · evidence-backed decision axis not silently dropped (recorded if dropped)",
  /publishedAxes|axis_role|rejected_as_question|decision-record/.test(idx),
  "new brain must expose published/rejected axes so a dropped evidence-backed axis is auditable");

const failed = checks.filter(c => !c.pass);
console.log("\n=== Part-2 structural guards (RED-FIRST — must go GREEN after the rebuild) ===");
for (const c of checks) console.log(`  ${c.pass ? "✓" : "✗ FAIL"}  ${c.name}${c.detail ? "  — " + c.detail : ""}`);
console.log(`\n${failed.length ? "❌ RED — " + failed.length + " guard(s) fail on the CURRENT brain (expected pre-rebuild)" : "✅ GREEN — structural guards satisfied"}\n`);
