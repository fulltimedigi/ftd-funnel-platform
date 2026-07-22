/**
 * engine/leadCapture.js — Lead capture (SPEC §10).
 *
 * Responsibility:
 *   Render the configurable lead form, validate it, and submit it via an
 *   injected `onSubmit(values)` (the controller wires this to the sheets sink).
 *   Manages loading / error states. Provides a skip path.
 *
 * It does NOT know about the backend — submission is injected, so it stays
 * testable and the transport can change without touching this module.
 *
 * RULE (SPEC §10): no silent success. If submission fails, the user sees an
 *   honest error and can retry or skip — they are never told it saved when it
 *   did not.
 *
 * renderLeadCapture(ctx) where ctx = { config, onSubmit(values)->Promise<{ok}>, onSkip() }
 *   → { node, inputs, submitBtn, skipBtn, validate }
 */

import { el } from "./dom.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pure validation: true when all required fields are present and emails valid. */
export function validateLead(fields, values) {
  for (const f of fields) {
    const v = (values[f.name] ?? "").trim();
    if (f.required && !v) return false;
    if (f.type === "email" && (f.required || v) && !EMAIL_RE.test(v)) return false;
  }
  return true;
}

export function renderLeadCapture(ctx) {
  const { config, onSubmit, onSkip } = ctx;
  const lf = config.leadForm || {};
  const fields = lf.fields || [];
  const inputs = {};

  const fieldEls = fields.map((f) => {
    const input = el("input", {
      type: f.type || "text",
      id: "ftd-f-" + f.name,
      class: "ftd-input",
      placeholder: f.label || f.name,
      // email/phone read left-to-right even inside the RTL page
      ...(f.type === "email" || f.type === "tel" ? { dir: "ltr" } : {}),
    });
    inputs[f.name] = input;
    input.addEventListener("input", validate);
    return el("div", { class: "ftd-field" }, [
      el("label", { class: "ftd-label", for: "ftd-f-" + f.name, text: f.label || f.name }),
      input,
    ]);
  });

  const statusEl = el("p", { class: "ftd-lead-status" });
  const submitBtn = el("button", { class: "ftd-submit", type: "button", text: lf.submitLabel || "إرسال ←" });
  const skipBtn =
    lf.skippable !== false
      ? el("button", { class: "ftd-skip", type: "button", text: "تخطّي — اعرض نتيجتي مباشرة" })
      : null;

  function readValues() {
    const out = {};
    for (const f of fields) out[f.name] = (inputs[f.name]?.value || "").trim();
    return out;
  }

  function validate() {
    submitBtn.disabled = !validateLead(fields, readValues());
  }

  let busy = false;
  async function doSubmit() {
    if (busy) return;
    const values = readValues();
    if (!validateLead(fields, values)) return;
    busy = true;
    submitBtn.disabled = true;
    statusEl.className = "ftd-lead-status";
    statusEl.textContent = "جارٍ الحفظ…";
    try {
      const res = await onSubmit(values);
      if (res && res.ok) {
        // controller advances to the result; this node is discarded.
        return;
      }
      statusEl.className = "ftd-lead-status is-error";
      statusEl.textContent = "تعذّر حفظ بياناتك. حاول مرة أخرى أو تخطَّ.";
      submitBtn.disabled = false;
    } catch (err) {
      statusEl.className = "ftd-lead-status is-error";
      statusEl.textContent = "حدث خطأ في الاتصال. حاول مرة أخرى.";
      submitBtn.disabled = false;
    } finally {
      busy = false;
    }
  }

  submitBtn.addEventListener("click", doSubmit);
  if (skipBtn) skipBtn.addEventListener("click", () => onSkip && onSkip());

  const node = el("section", { class: "ftd-screen ftd-lead" }, [
    el("div", { class: "ftd-lead-head" }, [
      el("h2", { class: "ftd-lead-title", text: "خطوة أخيرة" }),
      el("p", { class: "ftd-lead-sub", text: "أدخل بياناتك لعرض نتيجتك المخصّصة." }),
    ]),
    ...fieldEls,
    statusEl,
    submitBtn,
    lf.privacyNote ? el("p", { class: "ftd-privacy", text: lf.privacyNote }) : null,
    skipBtn,
  ]);

  submitBtn.disabled = true;
  validate();

  return { node, inputs, submitBtn, skipBtn, validate };
}
