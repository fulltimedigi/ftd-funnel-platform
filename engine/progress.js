/**
 * engine/progress.js — Progress UI.
 *
 * Responsibility (SPEC §5):
 *   Render the progress bar, the step counter ("current / total"), and an
 *   optional contextual label. Re-rendered fresh per step in Phase 1.
 *
 * NOTE: numerals are Western here; Arabic-numeral conversion lands with
 *   engine/i18n-rtl.js in a later phase.
 */

import { el } from "./dom.js";

export function renderProgress(current, total, label) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return el("div", { class: "ftd-progress" }, [
    el("div", { class: "ftd-progress-row" }, [
      el("span", { class: "ftd-progress-label", text: label || "" }),
      el("span", { class: "ftd-progress-step", text: `${current} / ${total}` }),
    ]),
    el("div", { class: "ftd-progress-track" }, [
      el("div", { class: "ftd-progress-fill", style: `width:${pct}%` }),
    ]),
  ]);
}
