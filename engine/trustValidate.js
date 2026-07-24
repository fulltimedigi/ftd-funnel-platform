/**
 * engine/trustValidate.js — Trust Validation (STEP 9).
 *
 * Turns the Standard's TRUST VALIDATION CHECK into an executable build gate so
 * no future edit can quietly violate it. The five questions, as code:
 *
 *   TV1  Are all results clearly defined?
 *   TV2  Does every question collect a necessary signal?
 *   TV3  Can every recommendation be defended?            (sweep the whole space)
 *   TV4  Does the result explain the decision?
 *   TV5  Does the output claim anything not explicitly measured?  (Rule 8 / 11)
 *
 * Returns { ok, findings:[{ severity:'blocker'|'warning', code, message }] }.
 * `ok` is false iff any blocker is present.
 */

import { decide } from "./decide.js";
import { buildRecommendations } from "./recommend.js";

/* Words that would imply intelligence the funnel never measured (Rule 8). */
const FAKE_INTELLIGENCE = [
  /personality/i, /psychometr/i, /psychological/i, /behaviou?ral profile/i,
  /leadership style/i, /readiness score/i, /confidence (level|score|%)/i,
  /\bIQ\b/, /strengths and weaknesses/i, /\b\d+% (match|ready|fit)\b/i,
];

/** The derived decision-signal ids — read from config, not hardcoded. */
function decisionKeys(config) {
  return (config.derivedSignals || []).map((d) => d.id);
}

/** Value domains for every signal a `needs`/`when`/sweep can reference: derived
 *  signals declare their own `domain`; presentation/offer signals carry theirs. */
function derivedDomains(config) {
  const d = {};
  for (const ds of config.derivedSignals || []) d[ds.id] = ds.domain || [];
  for (const s of config.signals || []) if (s.role && s.role !== "decision") d[s.id] = s.domain || [];
  return d;
}

/** Validate a { key: value|[values] } predicate against the derived domains. */
function predicateFindings(where, when, domains, push) {
  for (const [key, expected] of Object.entries(when || {})) {
    if (!(key in domains)) {
      push("blocker", "TV3_NEEDS_UNDEFINED_SIGNAL", `${where}: references undefined signal "${key}"`);
      continue;
    }
    for (const v of Array.isArray(expected) ? expected : [expected]) {
      if (!domains[key].includes(v)) {
        push("blocker", "TV3_NEEDS_BAD_VALUE", `${where}: value "${v}" not in domain of "${key}"`);
      }
    }
  }
}

function lintCopy(where, text, push) {
  if (typeof text !== "string") return;
  for (const re of FAKE_INTELLIGENCE) {
    if (re.test(text)) push("blocker", "TV5_FAKE_INTELLIGENCE", `${where}: unmeasured claim "${text}"`);
  }
}

export function trustValidate(config) {
  const findings = [];
  const push = (severity, code, message) => findings.push({ severity, code, message });
  const domains = derivedDomains(config);

  const archetypes = config.archetypes || [];
  const archById = new Map(archetypes.map((a) => [a.id, a]));
  const table = config.decisionTable || [];
  const questions = config.questions || [];
  const qIds = new Set(questions.map((q) => q.id));
  const signals = config.signals || [];

  /* ---- TV1 — all results clearly defined ---------------------------------- */
  // Discriminated union (ADR-0039, the ONE authorized trust change): a rule is COMMERCE (routes a
  // proven product) OR TERMINAL (an actionable honest ending — NO_MATCH/RESTART/… with a reason and
  // a next_action, and NO product/CTA). A TERMINAL cell is a valid trusted outcome, NOT a dead-end.
  const reachable = new Set(table.filter((r) => r.kind !== "TERMINAL").map((r) => r.result));
  for (const rule of table) {
    if (rule.kind === "TERMINAL") { validateTerminalRule(rule, push); continue; }
    // COMMERCE (or a legacy rule): must route to a real archetype AND carry a ProvenSelection when
    // the config is kernel-authored (legacy hand-built configs have no `proof` and are trusted via
    // the reachability + recommendation checks below).
    if (!archById.has(rule.result)) {
      push("blocker", "TV1_RESULT_MISSING", `rule "${rule.id}" → "${rule.result}" has no archetype`);
    }
    if (rule.when && !Object.keys(rule.when).length && rule.kind === "COMMERCE") {
      push("blocker", "TV1_DEFAULT_COMMERCE", `rule "${rule.id}" is when:{} COMMERCE — the default must be TERMINAL, never a product`);
    }
    if (rule.kind === "COMMERCE" && (!rule.proof || !rule.proof.product_id || !rule.proof.match_state)) {
      push("blocker", "TV1_COMMERCE_NO_PROOF", `COMMERCE rule "${rule.id}" has no ProvenSelection`);
    }
  }
  for (const a of archetypes) {
    if (!reachable.has(a.id)) push("warning", "TV1_UNREACHABLE", `archetype "${a.id}" is never selected by any rule`);
    const rec = a.recommendations && a.recommendations.primary;
    if (!a.name) push("blocker", "TV1_NO_NAME", `archetype "${a.id}" has no name`);
    if (!a.description) push("warning", "TV1_NO_DESCRIPTION", `archetype "${a.id}" has no description`);
    if (!rec || !rec.name || !rec.url || !rec.becauseTemplate) {
      push("blocker", "TV1_NO_RECOMMENDATION", `archetype "${a.id}" lacks a complete primary recommendation (name/url/becauseTemplate)`);
    }
    // contextual offers live under recommendations.contextual; under resultExtras they are silently ignored by recommend.js
    if (a.resultExtras && a.resultExtras.contextual) {
      push("blocker", "TV1_CONTEXTUAL_MISPLACED", `archetype "${a.id}" has resultExtras.contextual — it belongs under recommendations.contextual (otherwise dropped)`);
    }
  }

  /* ---- TV2 — every question collects a necessary signal ------------------- */
  const sourced = new Set(signals.map((s) => s.source));
  for (const q of questions) {
    if (!sourced.has(q.id)) push("blocker", "TV2_QUESTION_NO_SIGNAL", `question "${q.id}" feeds no signal (theater)`);
  }
  for (const s of signals) {
    if (!qIds.has(s.source)) push("blocker", "TV2_SIGNAL_NO_QUESTION", `signal "${s.id}" sources missing question "${s.source}"`);
    const q = questions.find((x) => x.id === s.source);
    if (q && s.required !== false) {
      const optIds = new Set(q.options.map((o) => o.id));
      for (const id of optIds) {
        if (!s.map || s.map[id] == null) push("blocker", "TV2_OPTION_UNMAPPED", `option "${id}" of "${q.id}" maps to no canonical value`);
      }
    }
  }
  // no orphan decision signal (Rule 4): each derived decision signal appears in some rule.when
  const keys = decisionKeys(config);
  const usedKeys = new Set();
  for (const rule of table) for (const k of Object.keys(rule.when || {})) usedKeys.add(k);
  for (const k of keys) {
    if (!usedKeys.has(k)) push("blocker", "TV2_ORPHAN_SIGNAL", `decision signal "${k}" is never used by the decision table`);
  }

  /* ---- TV3/TV5 — predicate domains, copy lint, then SWEEP the whole space - */
  for (const rule of table) predicateFindings(`rule "${rule.id}"`, rule.when, domains, push);
  for (const a of archetypes) {
    const ex = a.resultExtras || {};
    lintCopy(`${a.id}.description`, a.description, push);
    lintCopy(`${a.id}.name`, a.name, push);
    const rec = (a.recommendations && a.recommendations.primary) || {};
    lintCopy(`${a.id}.because`, rec.becauseTemplate, push);
    for (const v of ex.variants || []) { predicateFindings(`${a.id} variant`, v.needs, domains, push); lintCopy(`${a.id} variant`, v.becauseTemplate, push); }
    for (const w of ex.why || []) { predicateFindings(`${a.id} why`, w.needs, domains, push); lintCopy(`${a.id} why`, w.claim, push); }
    for (const w of ex.whyNot || []) { predicateFindings(`${a.id} whyNot`, w.needs, domains, push); lintCopy(`${a.id} whyNot`, w.claim, push); }
    for (const c of (a.recommendations && a.recommendations.contextual) || []) { predicateFindings(`${a.id} contextual`, c.needs, domains, push); lintCopy(`${a.id} contextual`, c.becauseTemplate, push); }
  }

  // TV3 + TV4: every reachable cell of the derived decision-signal space must
  // yield a defensible, explained result. Axes + presentation defaults from config.
  const axes = keys.map((k) => (domains[k] && domains[k].length ? domains[k] : [undefined]));
  const presDefaults = {};
  for (const s of signals) if (s.role && s.role !== "decision") presDefaults[s.id] = s.default ?? (s.domain && s.domain[0]);
  for (const combo of product(...axes)) {
    const sig = { ...presDefaults };
    keys.forEach((k, i) => { sig[k] = combo[i]; });
    const cellId = keys.map((k) => sig[k]).join("/");
    const { result, ruleId, kind } = decide(sig, table);
    // A TERMINAL cell is a trusted, actionable ending (validated at rule level in TV1) — NOT a
    // dead-end. It carries no product; the runtime draws its state + next_action, never a blank.
    if (kind === "TERMINAL") continue;
    const arch = archById.get(result);
    if (!arch) { push("blocker", "TV3_DEAD_END", `cell ${cellId} resolves to nothing (no product, no honest terminal)`); continue; }
    const out = buildRecommendations({ primary: arch }, { signals: sig, ruleId }, config);
    const where = `${result} @ ${cellId}`;
    if (!out.primary) push("blocker", "TV3_NO_BECAUSE", `${where}: recommendation suppressed (no because)`);
    else {
      if (out.primary.why.length === 0) push("blocker", "TV3_NO_WHY", `${where}: zero 'why it fits' reasons`);
      if (!out.primary.nextAction) push("blocker", "TV4_NO_NEXT_ACTION", `${where}: no next action`);
    }
  }

  return { ok: !findings.some((f) => f.severity === "blocker"), findings };
}

/** An honest TERMINAL rule: a known state, a reason, a message key, an actionable next step, and
 *  NO product/CTA. A publish-time NO_MATCH must carry a terminal_proof (kernel proved no candidate).
 *  This is the authorized trust extension — it keeps trust's teeth: a blank screen or an
 *  action-less terminal or a terminal carrying a product still FAILS. */
const TERMINAL_STATES = new Set(["NO_MATCH", "RESTART_REQUIRED", "STALE", "HANDOFF_UNBOUND", "INVALID_ARTIFACT"]);
const NEXT_ACTIONS = new Set(["START_OVER", "EDIT_ANSWERS", "REFRESH", "BROWSE_CATALOG"]);
function validateTerminalRule(rule, push) {
  const id = rule.id;
  if (!TERMINAL_STATES.has(rule.terminal_state)) push("blocker", "TV_TERMINAL_STATE", `terminal rule "${id}" has no valid terminal_state`);
  if (!rule.reason_code) push("blocker", "TV_TERMINAL_REASON", `terminal rule "${id}" has no reason_code`);
  if (!rule.message_key) push("blocker", "TV_TERMINAL_MESSAGE", `terminal rule "${id}" has no message_key`);
  if (!NEXT_ACTIONS.has(rule.next_action)) push("blocker", "TV_TERMINAL_NO_ACTION", `terminal rule "${id}" has no actionable next_action (a blank screen is a dead-end)`);
  // a terminal must NEVER carry a product / buy CTA
  if (rule.result || (rule.proof && rule.proof.product_id) || rule.product || rule.cta) push("blocker", "TV_TERMINAL_HAS_PRODUCT", `terminal rule "${id}" must not carry a product/CTA`);
  // an authored NO_MATCH must prove no candidate exists (kernel returned no product within bounds).
  if (rule.terminal_state === "NO_MATCH" && !rule.terminal_proof) push("blocker", "TV_TERMINAL_NO_PROOF", `NO_MATCH rule "${id}" has no terminal_proof`);
}

function product(...arrs) {
  return arrs.reduce((acc, arr) => acc.flatMap((a) => arr.map((b) => [...a, b])), [[]]);
}

export default { trustValidate };
