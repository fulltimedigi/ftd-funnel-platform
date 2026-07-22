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

export function renderProgress(current, total, label, lang = "ar") {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
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
