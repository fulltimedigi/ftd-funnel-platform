/**
 * authoring/ingest/report.js — Human-readable ingestion report.
 * ---------------------------------------------------------------------------
 * Stage 1 (ADR-0013). Turns an ingestCatalog() result into a plain summary for
 * the operator / logs — honest about coverage, method mix, and whether the site
 * is too thin to build from. Pure, Node-safe.
 */

/** @param {Object} result - the object returned by ingestCatalog() */
export function formatReport(result) {
  if (!result) return "No ingestion result.";
  if (!result.ok) {
    return [`Ingestion did not run (${result.reason}).`, ...(result.notes || []).map((n) => `  - ${n}`)].join("\n");
  }
  const r = result.report || {};
  const methods = Object.entries(r.byMethod || {}).map(([m, n]) => `${m}=${n}`).join(", ") || "none";
  const lines = [
    `Catalog for ${result.brandUrl}`,
    `  Usable products : ${r.usable}`,
    `  With a price    : ${r.withPrice} (${r.coverage}%)`,
    `  By method       : ${methods}`,
    `  Avg confidence  : ${r.avgConfidence}`,
    `  Dropped (no URL): ${r.dropped}`,
    `  Duplicates merged: ${r.duplicatesMerged}`,
    `  Requests made   : ${r.fetchStats ? r.fetchStats.requests : "?"}`,
    `  Thin (template fallback needed): ${r.thin ? "YES" : "no"}`,
  ];
  if (result.notes && result.notes.length) {
    lines.push("Notes:");
    for (const n of result.notes) lines.push(`  - ${n}`);
  }
  return lines.join("\n");
}
