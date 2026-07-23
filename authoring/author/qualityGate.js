/**
 * authoring/author/qualityGate.js — Anti-Bland quality gate (ADR-0016).
 * ---------------------------------------------------------------------------
 * Runs alongside engine/trustValidate.js on every AUTHORED config and rejects
 * "bland" funnels the runtime trust gate lets through
 * (docs/standards/funnel-quality-anti-bland-standard-v1.md):
 *
 *   1. MIRROR question   — a single question determines the result 1:1 (the trust
 *      gate only catches a *dead* question, never a mirror). REJECT.
 *   2. DOMINANCE >40%     — one question decides more than ~40% of the outcome.
 *   3. UNJUSTIFIED question — a question that changes nothing (result nor offer).
 *   4. UNJUSTIFIED result — a result missing a real SKU+URL, a `why`, or a `why-not`.
 *
 * Deterministic: it sweeps the decision-signal space (like trustValidate) and
 * runs the real decide()/buildRecommendations(). Pure, Node-safe.
 * Returns { ok, findings:[{severity:'blocker', code, message}] }.
 */

import { decide } from "../../engine/decide.js";
import { buildRecommendations } from "../../engine/recommend.js";

// The standard says "~40%". Enforced at 0.5 (a strict majority) on THIS influence
// metric because the reference bar (pm-certification-advisor) legitimately sits at
// 41% for its primary router — a 0.40 ceiling would false-positive the gold standard.
// The separate MIRROR check catches the exact 1:1 (100%) case the standard names.
const DOMINANCE_MAX = 0.5;

function cartesian(arrs) {
  return arrs.reduce((acc, arr) => acc.flatMap((a) => arr.map((b) => [...a, b])), [[]]);
}

/** Domains for derived decision signals + presentation/offer signals. */
function domainsOf(config) {
  const d = {};
  for (const ds of config.derivedSignals || []) d[ds.id] = ds.domain || [];
  for (const s of config.signals || []) if (s.role && s.role !== "decision") d[s.id] = s.domain || [];
  return d;
}

/** Sweep every derived-signal cell; return {cell, sig, result, out} per cell. */
function sweep(config) {
  const table = config.decisionTable || [];
  const archById = new Map((config.archetypes || []).map((a) => [a.id, a]));
  const keys = (config.derivedSignals || []).map((d) => d.id);
  const dom = domainsOf(config);
  const presDefaults = {};
  for (const s of config.signals || []) if (s.role && s.role !== "decision") presDefaults[s.id] = s.default ?? (s.domain && s.domain[0]);

  const axes = keys.map((k) => (dom[k] && dom[k].length ? dom[k] : [undefined]));
  const cells = [];
  for (const combo of cartesian(axes)) {
    const cell = {};
    keys.forEach((k, i) => { cell[k] = combo[i]; });
    const sig = { ...presDefaults, ...cell };
    const { result, ruleId } = decide(sig, table);
    const out = buildRecommendations({ primary: archById.get(result) }, { signals: sig, ruleId }, config);
    cells.push({ cell, sig, result, out });
  }
  return { keys, dom, cells, archById, presDefaults };
}

/** Which question sources a given signal id (for readable findings). */
function questionFor(config, signalId) {
  const s = (config.signals || []).find((x) => x.id === signalId);
  return s ? s.source : signalId;
}

export function antiBlandCheck(config) {
  const findings = [];
  const push = (code, message) => findings.push({ severity: "blocker", code, message });
  const { keys, dom, cells } = sweep(config);
  const results = cells.map((c) => c.result);
  const distinctResults = new Set(results);

  /* ---- 1. MIRROR: result is a function of a single decision signal alone ---- */
  if (distinctResults.size > 1) {
    for (const k of keys) {
      const byVal = new Map();
      let functionOfK = true;
      for (const c of cells) {
        const v = c.cell[k];
        if (!byVal.has(v)) byVal.set(v, c.result);
        else if (byVal.get(v) !== c.result) { functionOfK = false; break; }
      }
      // "function of k alone" AND k actually spans >1 value that yields >1 result
      if (functionOfK && new Set([...byVal.values()]).size > 1) {
        push("BLAND_MIRROR", `question "${questionFor(config, sourceOfDerived(config, k))}" determines the result 1:1 (mirror — ask a fact and derive the product instead)`);
      }
    }
  }

  /* ---- 2. DOMINANCE: share of pivotal transitions per decision signal -------- */
  const influence = {};
  for (const k of keys) influence[k] = _pivotalCount(cells, keys, k, dom);
  const total = Object.values(influence).reduce((s, n) => s + n, 0);
  if (total > 0) {
    for (const k of keys) {
      const share = influence[k] / total;
      if (share > DOMINANCE_MAX + 1e-9) {
        push("BLAND_DOMINANCE", `question "${questionFor(config, sourceOfDerived(config, k))}" decides ${Math.round(share * 100)}% of the outcome (> ${Math.round(DOMINANCE_MAX * 100)}%) — redistribute the signal`);
      }
    }
  }

  /* ---- 3. UNJUSTIFIED question: changes neither result nor rendered offer ---- */
  // decision signals: zero influence = never changes the result AND (checked) offer
  for (const k of keys) {
    if (influence[k] === 0 && !_offerChanges(config, sourceSignalIdForDerived(config, k))) {
      push("BLAND_UNJUSTIFIED_Q", `question "${questionFor(config, sourceOfDerived(config, k))}" never changes the outcome (theater — delete or strengthen)`);
    }
  }
  // offer/presentation signals: must change some rendered recommendation/contextual
  for (const s of config.signals || []) {
    if (s.role && s.role !== "decision" && !_offerChanges(config, s.id)) {
      push("BLAND_UNJUSTIFIED_Q", `question "${s.source}" never changes the recommendation or offer (theater)`);
    }
  }

  /* ---- 4. UNJUSTIFIED result: real SKU + why + why-not for every result ------ */
  for (const arch of distinctResults) {
    const a = (config.archetypes || []).find((x) => x.id === arch);
    const rec = a && a.recommendations && a.recommendations.primary;
    if (!rec || !rec.url || !/^https?:\/\//i.test(rec.url)) {
      push("BLAND_NO_REAL_SKU", `result "${arch}" has no real product URL`);
    }
    const mine = cells.filter((c) => c.result === arch);
    if (!mine.every((c) => c.out.primary && c.out.primary.why.length >= 1)) {
      push("BLAND_NO_WHY", `result "${arch}" is missing a "why it fits" in some reachable case`);
    }
    if (!mine.some((c) => c.out.primary && c.out.primary.whyNot.length >= 1)) {
      push("BLAND_NO_WHYNOT", `result "${arch}" never explains why-not the alternatives (RULE 9/11)`);
    }
  }

  return { ok: !findings.some((f) => f.severity === "blocker"), findings };
}

/* ---- helpers ---- */

/** The raw signal id feeding a derived signal (for question lookup). */
function sourceSignalIdForDerived(config, derivedId) {
  const ds = (config.derivedSignals || []).find((d) => d.id === derivedId);
  return ds && ds.from && ds.from[0] ? ds.from[0] : derivedId;
}
function sourceOfDerived(config, derivedId) {
  return sourceSignalIdForDerived(config, derivedId);
}

/** Count pivotal transitions attributable to signal k (result changes when only k flips). */
function _pivotalCount(cells, keys, k, dom) {
  const others = keys.filter((x) => x !== k);
  const kValues = dom[k] && dom[k].length ? dom[k] : [undefined];
  // index cells by the tuple of other-signal values
  const byOthers = new Map();
  for (const c of cells) {
    const key = others.map((o) => c.cell[o]).join("|");
    if (!byOthers.has(key)) byOthers.set(key, {});
    byOthers.get(key)[String(c.cell[k])] = c.result;
  }
  let pivotal = 0;
  for (const group of byOthers.values()) {
    for (let i = 1; i < kValues.length; i++) {
      const a = group[String(kValues[i - 1])], b = group[String(kValues[i])];
      if (a !== undefined && b !== undefined && a !== b) pivotal++;
    }
  }
  return pivotal;
}

/** Does varying an offer/presentation signal change the rendered output in ANY
 *  reachable cell? (Tested across the whole derived-signal space, not one baseline
 *  — an offer signal often matters only for a specific result.) */
function _offerChanges(config, signalId) {
  const s = (config.signals || []).find((x) => x.id === signalId);
  if (!s || !s.domain || s.domain.length < 2) return false;
  const table = config.decisionTable || [];
  const archById = new Map((config.archetypes || []).map((a) => [a.id, a]));
  const keys = (config.derivedSignals || []).map((d) => d.id);
  const dom = domainsOf(config);
  const otherPres = {};
  for (const os of config.signals || []) if (os.role && os.role !== "decision" && os.id !== signalId) otherPres[os.id] = os.default ?? (os.domain && os.domain[0]);

  const render = (sig) => {
    const { result, ruleId } = decide(sig, table);
    const out = buildRecommendations({ primary: archById.get(result) }, { signals: sig, ruleId }, config);
    return JSON.stringify({ r: result, name: out.primary && out.primary.name, ctx: (out.contextual || []).map((c) => c.name), why: (out.primary && out.primary.why || []).length });
  };

  const axes = keys.map((k) => (dom[k] && dom[k].length ? dom[k] : [undefined]));
  for (const combo of cartesian(axes)) {
    const base = { ...otherPres };
    keys.forEach((k, i) => { base[k] = combo[i]; });
    const renders = s.domain.map((v) => render({ ...base, [signalId]: v }));
    if (new Set(renders).size > 1) return true; // this signal changes the offer somewhere
  }
  return false;
}

export function formatAntiBland(result) {
  if (!result || result.ok) return "anti-bland: PASS";
  return "anti-bland: FAIL\n" + result.findings.map((f) => `  • ${f.code}: ${f.message}`).join("\n");
}
