/**
 * engine/decide.js — Decision Logic (STEP 7) for "decision-table" funnels.
 *
 * Responsibility:
 *   Map the derived decision signals (engine/signals.js) to ONE result archetype
 *   id, using an ORDERED, first-match-wins rule list carried in the config
 *   (config.decisionTable). The rules ARE the frozen Result Architecture v3
 *   precedence — encoded as data, not hardcoded here, so the logic stays
 *   auditable and the engine stays generic.
 *
 *   A rule: { id, when: { <signalKey>: value | [values] }, result: "<archetypeId>" }
 *     - omitted signalKey   = wildcard
 *     - scalar value        = strict equality
 *     - array value         = membership ("in")
 *     - when: {}            = always matches (use as the final safety net)
 *
 * Output is the SAME stable shape scoring.js returns for the point-based modes,
 *   so resolver.js / recommend.js consume it without caring which mode ran —
 *   plus two extra keys (`signals`, `ruleId`) for because-templates and audit.
 */

import { collectRawSignals, deriveSignals } from "./signals.js";

/** True iff every predicate in `when` holds for `signals`. */
export function matchRule(signals, when) {
  for (const [key, expected] of Object.entries(when || {})) {
    const actual = signals[key];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Walk the ordered table; first matching rule wins.
 * @returns {{ result:?string, ruleId:?string }}
 */
export function decide(signals, decisionTable = []) {
  for (const rule of decisionTable) {
    if (matchRule(signals, rule.when)) {
      return { result: rule.result, ruleId: rule.id };
    }
  }
  return { result: null, ruleId: null }; // total tables never reach here
}

/**
 * Engine entry for scoring.mode === "decision-table".
 * answers → raw signals → derived signals → decision → stable scoring shape.
 */
export function scoreDecisionTable(config, answers) {
  const signals = deriveSignals(config, collectRawSignals(answers, config));
  const { result, ruleId } = decide(signals, config.decisionTable);
  const id = result;
  return {
    primary: id,
    secondary: null,
    scores: id ? { [id]: 1 } : {},
    flags: [],
    sorted: id ? [[id, 1]] : [],
    signals, // derived DS1/DS2/DS3/DS5 + goal/learning_mode (+ clamp meta)
    ruleId, // which rule fired — traceability/audit
  };
}

export default { matchRule, decide, scoreDecisionTable };
