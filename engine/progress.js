/**
 * engine/progress.js — Progress UI.
 *
 * Responsibility (SPEC §5):
 *   Render the progress bar, the step counter ("current / total"), and an
 *   optional contextual label. Re-rendered fresh per step in Phase 1.
 *
 * Numerals are localized (Arabic-Indic for RTL languages) via engine/i18n-rtl.js.
 */

import { el } from "./dom.js";
import { formatStepCounter } from "./i18n-rtl.js";

/**
 * Progress percentage with a momentum FLOOR (UX_INTERFACE_DECISION: the bar
 * starts at ~15%, never 0%, so the respondent feels underway from question one).
 * `current` is 1-based; monotonic in `current`; capped at 100.
 */
export const PROGRESS_FLOOR = 15;
export function progressPercent(current, total) {
  const steps = Math.max(total || 0, 1);
  const c = Math.max(1, current || 1);
  const raw = PROGRESS_FLOOR + ((c - 1) / steps) * (100 - PROGRESS_FLOOR);
  return Math.min(100, Math.round(raw));
}

export function renderProgress(current, total, label, lang = "ar") {
  const pct = total > 0 ? progressPercent(current, total) : 0;
  return el("div", { class: "ftd-progress" }, [
    el("div", { class: "ftd-progress-row" }, [
      el("span", { class: "ftd-progress-label", text: label || "" }),
      el("span", { class: "ftd-progress-step", text: formatStepCounter(current, total, lang) }),
    ]),
    el("div", { class: "ftd-progress-track" }, [
      el("div", { class: "ftd-progress-fill", style: `width:${pct}%` }),
    ]),
  ]);
}
