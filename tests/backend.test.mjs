/**
 * tests/backend.test.mjs — Apps Script backend (Code.gs), ADR-0012.
 *
 * Runs the real integrations/google-apps-script/Code.gs inside a fake Apps Script
 * environment (in-memory SpreadsheetApp + CacheService + ContentService) so its
 * logic is verified without a live Google account: per-funnel tab isolation,
 * type routing (lead/event/error), email upsert (create then update, no dup),
 * funnelId sanitization, and honest error responses for bad input.
 *
 * Pure Node (node:vm). No deps, no network. Exits non-zero on failure.
 */

import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODE = readFileSync(join(__dirname, "../integrations/google-apps-script/Code.gs"), "utf8");

/* ------------------------------------ fake Apps Script (in-memory) --------- */
function makeSheet(name) {
  const rows = [];
  const sheet = {
    getName: () => name,
    appendRow: (r) => { rows.push(r.slice()); },
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    setFrozenRows: () => sheet,
    autoResizeColumn: () => sheet,
    setColumnWidth: () => sheet,
    getRange: (r, c, nr = 1, nc = 1) => {
      const range = {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const rr = [];
            for (let j = 0; j < nc; j++) { const row = rows[r - 1 + i]; rr.push(row ? (row[c - 1 + j] ?? "") : ""); }
            out.push(rr);
          }
          return out;
        },
        setValues(vals) {
          for (let i = 0; i < vals.length; i++) {
            const tr = r - 1 + i; if (!rows[tr]) rows[tr] = [];
            for (let j = 0; j < vals[i].length; j++) rows[tr][c - 1 + j] = vals[i][j];
          }
          return range;
        },
        setBackground: () => range, setFontColor: () => range, setFontWeight: () => range, setFontSize: () => range,
      };
      return range;
    },
    _rows: rows,
  };
  return sheet;
}
function makeSpreadsheet() {
  const sheets = {};
  return {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { sheets[n] = makeSheet(n); return sheets[n]; },
    _sheets: sheets,
  };
}
function makeCache() {
  const m = {};
  return { get: (k) => (k in m ? m[k] : null), put: (k, v) => { m[k] = v; }, remove: (k) => { delete m[k]; } };
}

/** Fresh backend instance: returns { ss, post(payload)->result, get()->result }. */
function loadBackend() {
  const ss = makeSpreadsheet();
  const cache = makeCache();
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    CacheService: { getScriptCache: () => cache },
    ContentService: {
      createTextOutput: (s) => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } }),
      MimeType: { JSON: "application/json" },
    },
    Logger: { log: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox);
  const parse = (out) => JSON.parse(out.getContent());
  return {
    ss,
    post: (payload) => parse(sandbox.doPost({ postData: { contents: JSON.stringify(payload) } })),
    get: () => parse(sandbox.doGet()),
    _raw: sandbox,
  };
}

const lead = (over = {}) => ({
  type: "lead", funnelId: "freelancex", name: "سيف", email: "saif@example.com", phone: "+96550000000",
  primaryArchetype: "development", primaryArchetypeName: "مطوّر", flags: ["EN_GOOD"],
  scores: { development: 12 }, answers: { q1: "c" }, resultLayout: "tracks", source: "FreelanceX", ...over,
});

let passed = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; });
}

/* ---------------------------------------------------------------- tests ---- */
await (async () => {
  console.log("\nRouting + health:");
  await check("doGet is a health check", () => {
    const g = loadBackend().get();
    assert.equal(g.ok, true);
    assert.ok(g.version);
  });
  await check("unknown type is rejected honestly", () => {
    assert.equal(loadBackend().post({ type: "wat", funnelId: "freelancex" }).ok, false);
  });

  console.log("\nLeads — per-funnel tab + email upsert:");
  await check("a lead creates '<funnelId> Leads' with header + row; email lowercased in col 4", () => {
    const be = loadBackend();
    const r = be.post(lead({ email: "Saif@Example.com" }));
    assert.equal(r.ok, true);
    assert.equal(r.action, "created");
    const sh = be.ss._sheets["freelancex Leads"];
    assert.ok(sh, "Leads tab created");
    assert.equal(sh._rows.length, 2, "header + 1 data row");
    assert.equal(sh._rows[1][3], "saif@example.com", "email lowercased at column 4");
    assert.equal(sh._rows[1][1], "freelancex", "funnelId column");
  });

  await check("same email again UPDATES in place (no duplicate row)", () => {
    const be = loadBackend();
    be.post(lead());
    const r2 = be.post(lead({ name: "سيف ٢", scores: { development: 20 } }));
    assert.equal(r2.action, "updated");
    const sh = be.ss._sheets["freelancex Leads"];
    assert.equal(sh._rows.length, 2, "still one data row");
    assert.equal(sh._rows[1][2], "سيف ٢", "name updated in place");
  });

  await check("a different email APPENDS a new row", () => {
    const be = loadBackend();
    be.post(lead());
    const r2 = be.post(lead({ email: "other@example.com" }));
    assert.equal(r2.action, "created");
    assert.equal(be.ss._sheets["freelancex Leads"]._rows.length, 3, "header + 2 data rows");
  });

  console.log("\nPer-funnel isolation:");
  await check("a second funnel gets its OWN Leads tab; the first is untouched", () => {
    const be = loadBackend();
    be.post(lead()); // freelancex
    be.post(lead({ funnelId: "asq-perfume", email: "noor@example.com" }));
    assert.equal(be.ss._sheets["freelancex Leads"]._rows.length, 2);
    assert.equal(be.ss._sheets["asq-perfume Leads"]._rows.length, 2);
  });

  console.log("\nEvents + errors routing:");
  await check("an event appends to '<funnelId> Events'", () => {
    const be = loadBackend();
    const r = be.post({ type: "event", funnelId: "freelancex", event: "quiz_start", payload: JSON.stringify({ theme: "x" }) });
    assert.equal(r.ok, true);
    const sh = be.ss._sheets["freelancex Events"];
    assert.equal(sh._rows.length, 2);
    assert.equal(sh._rows[1][2], "quiz_start");
  });

  await check("an error appends to '<funnelId> Errors' (our field names)", () => {
    const be = loadBackend();
    const r = be.post({ type: "error", funnelId: "freelancex", level: "error", message: "boom", url: "https://x/", userAgent: "UA", context: { a: 1 } });
    assert.equal(r.ok, true);
    const sh = be.ss._sheets["freelancex Errors"];
    assert.equal(sh._rows.length, 2);
    assert.equal(sh._rows[1][3], "boom", "message column");
    assert.equal(sh._rows[1][6], JSON.stringify({ a: 1 }), "context JSON column");
  });

  console.log("\nValidation (honest failure, no tab pollution):");
  await check("a malicious funnelId is rejected and creates no tab", () => {
    const be = loadBackend();
    const r = be.post(lead({ funnelId: "../evil/path" }));
    assert.equal(r.ok, false);
    assert.equal(Object.keys(be.ss._sheets).length, 0, "no sheet created for a bad funnelId");
  });
  await check("a lead with no email is rejected", () => {
    assert.equal(loadBackend().post(lead({ email: "" })).ok, false);
  });
  await check("missing funnelId is rejected", () => {
    assert.equal(loadBackend().post({ type: "event", event: "x" }).ok, false);
  });

  if (process.exitCode === 1) console.error("\nFAIL — backend tests did not all pass.\n");
  else console.log(`\nPASS — all ${passed} backend assertions passed.\n`);
})();
