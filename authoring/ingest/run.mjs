#!/usr/bin/env node
/**
 * authoring/ingest/run.mjs — Live CLI for catalog ingestion (ADR-0013).
 * ---------------------------------------------------------------------------
 *   node authoring/ingest/run.mjs <brand-url> [out.json]
 *
 * Runs the ingestion pipeline against a REAL site using the global fetch, prints
 * an honest coverage report, and writes the catalog JSON.
 *
 * SCOPE: only run this against a site you are authorized to ingest — your own
 * client's, per ADR-0013. Passing the URL here is the operator asserting that
 * authorization. Exit codes: 0 = products found · 2 = ran but empty/thin ·
 * 1 = refused / bad URL / error.
 */

import { writeFileSync } from "node:fs";
import { ingestCatalog } from "./index.js";
import { formatReport } from "./report.js";

const url = process.argv[2];
const out = process.argv[3] || "catalog.json";

if (!url) {
  console.error("Usage: node authoring/ingest/run.mjs <brand-url> [out.json]");
  console.error("Only run against a site you are authorized to ingest (your own client's).");
  process.exit(1);
}

console.error(`Ingesting ${url} … (authorized / own-client only)\n`);
const result = await ingestCatalog(url, { authorized: true });
console.error(formatReport(result));

if (!result.ok) process.exit(1);

writeFileSync(out, JSON.stringify(
  { brandUrl: result.brandUrl, origin: result.origin, report: result.report, products: result.products },
  null, 2,
));
console.error(`\nWrote ${result.products.length} product(s) → ${out}`);
process.exit(result.products.length ? 0 : 2);
