#!/usr/bin/env node
/**
 * authoring/run.mjs — Live CLI: brand URL → funnel config (Stage 1 + 2).
 * ---------------------------------------------------------------------------
 *   node authoring/run.mjs <brand-url> [out.json]   ·   npm run author -- <url>
 *
 * Ingests the real catalog and authors a funnel, then checks it against BOTH
 * gates (schema + trust) and writes the config. SCOPE: authorized / own-client
 * sites only (ADR-0013) — providing the URL asserts that authorization.
 * Exit: 0 = authored & gates pass · 2 = authored but a gate failed · 1 = could
 * not author (refused / empty / thin).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { generateFunnelFromUrl } from "./index.js";
import { validateConfig, formatValidationErrors } from "../engine/validateConfig.js";

const url = process.argv[2];
const out = process.argv[3] || "funnel.config.json";
if (!url) {
  console.error("Usage: node authoring/run.mjs <brand-url> [out.json]  (authorized / own-client sites only)");
  process.exit(1);
}

console.error(`Authoring a funnel from ${url} … (authorized / own-client only)\n`);
const res = await generateFunnelFromUrl(url, { authorized: true });

if (!res.ok) {
  console.error(`Could not author (${res.stage}: ${res.reason}).`);
  for (const n of res.notes || []) console.error(`  - ${n}`);
  if (res.stage === "ingest" || res.reason === "no-discriminating-axis") {
    console.error("→ This site is too thin / undifferentiated to auto-author. Use a vertical template (no fabrication).");
  }
  process.exit(1);
}

const schema = JSON.parse(readFileSync(new URL("../configs/_schema.json", import.meta.url)));
const vc = validateConfig(res.config, schema);

console.error(`Catalog     : ${res.catalog.products.length} real products`);
console.error(`Results     : ${res.meta.archetypes} (primary axis: ${res.meta.primaryAxis}; secondary: ${res.meta.secondaryAxes.join(", ") || "none"})`);
console.error(`Schema gate : ${vc.valid ? "PASS" : "FAIL"}`);
if (!vc.valid) console.error(formatValidationErrors(vc));
console.error(`Trust gate  : ${res.trust.ok ? "PASS" : "FAIL"}`);
if (!res.trust.ok) console.error(JSON.stringify(res.trust.findings.filter((f) => f.severity === "blocker"), null, 2));

writeFileSync(out, JSON.stringify(res.config, null, 2));
console.error(`\nWrote funnel config → ${out}`);
process.exit(vc.valid && res.trust.ok ? 0 : 2);
