/**
 * engine/questionRenderer.js — Render one question step.
 *
 * Responsibility (SPEC §5):
 *   From a question object render: progress, optional back button, header
 *   (label/text/hint), options grid (icon + label + description), and the
 *   next/submit button (disabled until an option is selected).
 *
 * Options are real <button>s (keyboard-focusable), not click-only divs.
 *
 * ctx = {
 *   selectedOptionId, onSelect(optionId), onNext(), onBack(),
 *   isFirst, isLast, current, total, label
 * }
 */

import { el } from "./dom.js";
import { renderProgress } from "./progress.js";

export function renderQuestion(question, ctx) {
  const { selectedOptionId, onSelect, onNext, onBack, isFirst, isLast, current, total, label } = ctx;

  const options = (question.options || []).map((o) => {
    const selected = o.id === selectedOptionId;
    return el(
      "button",
      {
        class: "ftd-opt" + (selected ? " is-selected" : ""),
        type: "button",
        "data-id": o.id,
        "aria-pressed": selected ? "true" : "false",
        onClick: () => onSelect(o.id),
      },
      [
        o.icon ? el("span", { class: "ftd-opt-icon", text: o.icon }) : null,
        el("span", { class: "ftd-opt-label", text: o.label }),
        o.description ? el("span", { class: "ftd-opt-desc", text: o.description }) : null,
      ]
    );
  });

  return el("section", { class: "ftd-screen ftd-question" }, [
    renderProgress(current, total, label),
    !isFirst ? el("button", { class: "ftd-back", type: "button", onClick: onBack, text: "→ رجوع" }) : null,
    el("div", { class: "ftd-q-head" }, [
      question.label ? el("p", { class: "ftd-q-label", text: question.label }) : null,
      el("h2", { class: "ftd-q-text", text: question.text }),
      question.hint ? el("p", { class: "ftd-q-hint", text: question.hint }) : null,
    ]),
    el("div", { class: "ftd-opts" }, options),
    el("button", {
      class: "ftd-next",
      type: "button",
      disabled: selectedOptionId ? null : "true",
      onClick: onNext,
      text: isLast ? "اعرض نتيجتي ✦" : "التالي ←",
    }),
  ]);
}
