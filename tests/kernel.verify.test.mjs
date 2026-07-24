/**
 * tests/kernel.verify.test.mjs — publish-time exhaustive verification, runtime re-verify, and the
 * v3 promise metrics, on the oud-shaped fixture + a diverse battery (ADR-0037).
 * Proves the 6 exit criteria hold for EVERY reachable path of a REAL-shaped funnel — not only
 * synthetic CI — and that the runtime verifier + metrics read the same structured proof.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorFunnel } from "../authoring/author/index.js";
import { verifyFunnel } from "../engine/kernel/verifyFunnel.js";
import { verifyServedResult } from "../engine/kernel/verifyRuntime.js";
import { funnelMetrics } from "../engine/kernel/metrics.js";

let passed = 0;
const check = (n, f) => { try { f(); passed++; console.log(`  ✓ ${n}`); } catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); process.exitCode = 1; } };

const CHARS = ["woody", "floral", "smoky", "fresh"];
const battery = [];
battery.push({ v: "oud (real-shaped fixture)", cat: JSON.parse(readFileSync(new URL("./fixtures/oud-shaped.synthetic.json", import.meta.url), "utf8")) });
battery.push({ v: "laptops", cat: { origin: "https://tech.example", products:
  [["Air 13","apple","macos",1200],["Pro 14","apple","macos",2400],["Pro 16","apple","macos",3500],["XPS 13","dell","windows",1100],["XPS 15","dell","windows",1900],["G15","dell","windows",1500],["ThinkPad X1","lenovo","windows",1700],["Legion 5","lenovo","windows",1400],["IdeaPad 3","lenovo","windows",600],["Chromebook","hp","chromeos",400],["Pavilion 15","hp","windows",800],["Spectre","hp","windows",1600]]
  .map(([n,b,os,price],i)=>({ name:`${b} ${n}`, url:`https://tech.example/p/${i}`, price, attributes:{type:os}, differentiators:[b,os] })) } });
battery.push({ v: "coffee", cat: { origin: "https://coffee.example", products:
  [["Ethiopia Light","light",65],["Kenya Light","light",70],["Colombia Medium","medium",55],["Brazil Medium","medium",50],["Guatemala Medium","medium",58],["Sumatra Dark","dark",52],["Italian Dark","dark",48],["Espresso","dark",45],["House Blend","medium",40],["Decaf","medium",42]]
  .map(([n,roast,price],i)=>({ name:n, url:`https://coffee.example/p/${i}`, price, attributes:{type:roast}, differentiators:[roast] })) } });

for (const store of battery) {
  check(`${store.v}: publish-time verify proves all 6 exit criteria for every path`, () => {
    const gen = authorFunnel(store.cat, { brandName: store.v });
    assert.equal(gen.ok, true, "author failed: " + (gen.reason || ""));
    // the full axisSet-level proof the authoring layer computed (criteria 1–6)
    const v = gen.meta.verify;
    assert.ok(v && v.ok, `verify not clean: ${JSON.stringify((v && v.findings || []).slice(0, 4))}`);
    assert.ok(v.checked >= 1, "at least one path was proven");

    // versions present (G2)
    assert.ok(gen.config.catalog_version && gen.config.policy_version, "config carries catalog + policy versions");

    // runtime re-verify agrees on every rule; never-relax never appears relaxed
    const rank1 = (gen.config.constraintLadder || [])[0];
    for (const rule of gen.config.decisionTable) {
      if (!rule.when || !Object.keys(rule.when).length) continue;
      const resolved = { scoring: { ruleId: rule.id }, primary: gen.config.archetypes.find((a) => a.id === rule.result) };
      const rv = verifyServedResult(gen.config, resolved);
      assert.ok(rv.ok, `runtime verify failed on ${rule.id}: ${rv.reasons.join("; ")}`);
      for (const c of rule.proof.conflicts || []) assert.notEqual(c.axis, rank1, `rank-1 ${rank1} relaxed on ${rule.id}`);
    }
  });

  check(`${store.v}: v3 metrics are sane and structured disclosure is renderable`, () => {
    const gen = authorFunnel(store.cat, { brandName: store.v });
    const m = funnelMetrics(gen.config, store.cat);
    assert.ok(m.exactPathRate >= 0 && m.exactPathRate <= 1);
    assert.equal(m.prefixSupport, 1, "every offered answer is reachable (no dead option)");
    assert.equal(m.versioned, true, "staleness/version metric present");
    assert.equal(m.disclosureRendering, 1, "every compromised path carries structured disclosure");
    assert.ok(m.predicateEvidenceCoverage >= 0 && m.predicateEvidenceCoverage <= 1);
    console.log(`    ${store.v}: exact=${(m.exactPathRate * 100).toFixed(0)}% · maxSeverity=${m.maxRelaxationSeverity} · unknownRate=${(m.unknownAttributeRate * 100).toFixed(0)}% · evidence=${(m.predicateEvidenceCoverage * 100).toFixed(0)}% · paths=${m.paths}`);
  });
}

check("a tampered table (never-relax relaxed) is refused by BOTH verifiers", () => {
  const cat = JSON.parse(readFileSync(new URL("./fixtures/oud-shaped.synthetic.json", import.meta.url), "utf8"));
  const products = cat.products;
  const gen = authorFunnel(cat, { brandName: "Tamper" });
  assert.equal(gen.ok, true, gen.reason);
  const rank1 = gen.config.constraintLadder[0];
  const rule = gen.config.decisionTable.find((r) => r.when && Object.keys(r.when).length);
  // inject a forbidden never-relax relaxation into the proof
  rule.proof.conflicts = [...(rule.proof.conflicts || []), { axis: rank1, label: "الشكل", magnitude: 1 }];
  const resolved = { scoring: { ruleId: rule.id }, primary: gen.config.archetypes.find((a) => a.id === rule.result) };
  assert.equal(verifyServedResult(gen.config, resolved).ok, false, "runtime verifier must refuse a never-relax break");
  const v = verifyFunnel(gen.config, { products }, undefined);
  assert.equal(v.ok, false, "publish verifier must refuse a never-relax break");
  assert.ok(v.findings.some((f) => f.criterion === 2), JSON.stringify(v.findings.slice(0, 3)));
});

if (process.exitCode === 1) console.error("\nFAIL — verification / metrics broke.\n");
else console.log(`\nPASS — all ${passed} verify + metrics assertions passed.\n`);
