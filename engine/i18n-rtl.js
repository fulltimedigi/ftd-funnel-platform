/**
 * engine/i18n-rtl.js — Arabic RTL helpers, numeral conversion, dir management.
 * ---------------------------------------------------------------------------
 * Arabic RTL is first-class, not bolted on (ADR-0008). Ported from the
 * production engine (replacing v0's throwing stub):
 *   - Western → Arabic-Indic numeral conversion
 *   - lang/dir on <html> + mount
 *   - LTR override for email/phone inputs inside an RTL page
 *   - locale-aware step / percent / blend formatting
 *
 * Host-safe: the pure helpers are Node-safe; the two DOM-touching helpers
 * (applyDocumentLocale, applyLTRInputs) guard for a missing `document` so they
 * are no-ops (and never throw) under Node/SSR.
 */

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
const WESTERN_DIGITS_RE = /[0-9]/g;

/** Convert Western (ASCII) digits in a string/number to Arabic-Indic numerals. */
export function toArabicNumerals(str) {
  return String(str).replace(WESTERN_DIGITS_RE, (d) => ARABIC_DIGITS[parseInt(d, 10)]);
}

/** True when the language tag is a right-to-left language. */
export function isRTL(lang) {
  return !!lang && (lang.startsWith("ar") || lang.startsWith("fa") || lang.startsWith("he") || lang.startsWith("ur"));
}

/**
 * Localize a bare number for display: Arabic-Indic numerals for RTL languages,
 * Western digits otherwise. The one call sites use for engine-generated numbers.
 */
export function localizeNum(value, lang) {
  return isRTL(lang) ? toArabicNumerals(value) : String(value);
}

/**
 * Apply lang + dir to <html> and (optionally) the mount. No-op without a DOM.
 * @param {string} lang
 * @param {HTMLElement} [mountEl]
 */
export function applyDocumentLocale(lang, mountEl) {
  const dir = isRTL(lang) ? "rtl" : "ltr";
  try {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = lang ?? "ar";
      document.documentElement.dir = dir;
    }
  } catch { /* non-fatal */ }
  if (mountEl && typeof mountEl.setAttribute === "function") {
    mountEl.setAttribute("lang", lang ?? "ar");
    mountEl.setAttribute("dir", dir);
  }
}

/**
 * Force LTR on email/phone inputs inside an RTL page (readability). No-op
 * without a queryable root. Must be called after the lead form renders.
 * @param {HTMLElement|Document} [root=document]
 */
export function applyLTRInputs(root) {
  const scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  const selectors = [
    'input[type="email"]',
    'input[type="tel"]',
    'input[name="email"]',
    'input[name="phone"]',
    "[data-ltr]",
  ];
  scope.querySelectorAll(selectors.join(",")).forEach((input) => {
    input.setAttribute("dir", "ltr");
    if (input.style) input.style.textAlign = "left";
  });
}

/** Format a step counter, e.g. "١ / ٦" (ar) or "1 / 6" (en). */
export function formatStepCounter(current, total, lang) {
  return `${localizeNum(current, lang)} / ${localizeNum(total, lang)}`;
}

/** Format a percentage, e.g. "٦٤٪" (ar) or "64%" (en). */
export function formatPercent(value, lang) {
  const num = Math.round(value);
  return isRTL(lang) ? `${toArabicNumerals(num)}٪` : `${num}%`;
}

/** Format a two-archetype blend proportion line, locale-aware. */
export function formatBlend(primaryPct, secondaryPct, primaryName, secondaryName, lang) {
  if (isRTL(lang)) {
    return `${toArabicNumerals(primaryPct)}٪ ${primaryName} · ${toArabicNumerals(secondaryPct)}٪ ${secondaryName}`;
  }
  return `${primaryPct}% ${primaryName} · ${secondaryPct}% ${secondaryName}`;
}

/** CSS text-align for the current dir. */
export function textAlign(lang) {
  return isRTL(lang) ? "right" : "left";
}

/** RTL-aware flex-direction. */
export function flexRow(lang) {
  return isRTL(lang) ? "row-reverse" : "row";
}

/** Strip HTML tags, returning safe text content. */
export function sanitizeText(str) {
  if (typeof str !== "string") return String(str ?? "");
  return str.replace(/<[^>]*>/g, "").trim();
}

/**
 * Fill a template: {questionId} → the chosen option's label for that question.
 * @param {string} template
 * @param {Object} answers - { questionId: optionId }
 * @param {Array} questions - full questions array
 */
export function fillTemplate(template, answers, questions) {
  if (!template) return "";
  return template.replace(/\{([^}]+)\}/g, (match, qId) => {
    const question = (questions || []).find((q) => q.id === qId);
    if (!question) return match;
    const optionId = answers[qId];
    if (!optionId) return match;
    const option = (question.options || []).find((o) => o.id === optionId);
    return option ? option.label : match;
  });
}
