/**
 * engine/index.js — Entry point + funnel controller.
 *
 * Responsibility (SPEC §5, §10):
 *   boot() fetches a config and starts a funnel. createFunnel() is the pure
 *   controller (config object + mount element): hero → questions → lead capture
 *   (gated, skippable) → result. Each screen is a full re-render.
 *
 * Lead loop (this phase): after the last question the result is computed, then —
 *   if leadForm.gated and has fields — the lead form is shown. On submit the
 *   tagged lead is sent to the sheets sink; on success (or skip) the result is
 *   shown. The fixed analytics vocabulary (docs/EVENTS.md) is emitted across the
 *   lifecycle to any configured sinks (ADR-0007).
 *
 * createFunnel(config, mountEl, deps) — deps.submitLead(payload)->Promise lets
 *   tests inject the transport; default is the Google Sheets sink built from
 *   config.analytics.sheetsEndpoint.
 */

import { el, mount } from "./dom.js";
import * as State from "./state.js";
import * as Flow from "./flow.js";
import { renderQuestion } from "./questionRenderer.js";
import { renderResult } from "./resultRenderer.js";
import { renderLeadCapture } from "./leadCapture.js";
import { score } from "./scoring.js";
import { resolve } from "./resolver.js";
import { buildRecommendations } from "./recommend.js";
import { registerSink as registerSheetsEventSink } from "../analytics/sheets-sink.js";
import { createLeadTransport } from "./leadTransport.js";
import { registerSink as registerGa4Sink } from "../analytics/ga4-sink.js";
import { createResilientSink } from "./leadQueue.js";
import * as analytics from "./analytics.js";
import { validateConfig, formatValidationErrors } from "./validateConfig.js";

export async function boot({ configUrl, mountEl, schemaUrl }) {
  const res = await fetch(configUrl);
  const config = await res.json();

  // Executable schema: load the sibling _schema.json (or an override) and run it.
  // If the schema can't be fetched, validation is skipped honestly — the funnel
  // still boots, but we say so rather than pretend it was validated.
  let schema = null;
  const sUrl = schemaUrl || (typeof configUrl === "string" ? configUrl.replace(/[^/]+$/, "_schema.json") : null);
  if (sUrl) {
    try {
      const sres = await fetch(sUrl);
      if (sres && sres.ok) schema = await sres.json();
      else console.warn("[ftd] schema not loaded — config validation skipped.");
    } catch {
      console.warn("[ftd] schema fetch failed — config validation skipped.");
    }
  }

  return createFunnel(config, mountEl, { schema });
}

/**
 * Generic theme loader: injects themes/<name>.css into the page. Resolves the
 * path relative to this module (engine/ is a sibling of themes/), so it works
 * regardless of where the funnel HTML lives. No-op outside a browser DOM.
 */
function loadTheme(name) {
  if (!name) return;
  try {
    if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") return;
    const href = new URL("../themes/" + name + ".css", import.meta.url).href;
    const link = document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", href);
    link.setAttribute("data-ftd-theme", name);
    document.head.appendChild(link);
  } catch {
    /* theme injection is non-fatal */
  }
}

/**
 * Brand auto-styling (ADR-0028): apply `config.themeVars` as :root CSS custom
 * property overrides so an AI/deterministically-authored funnel visually matches
 * the store (logo + palette extracted from the site). A few SAFE overrides only —
 * not a free-form theme editor. No-op outside a browser DOM.
 */
function applyThemeVars(vars) {
  if (!vars || typeof vars !== "object") return;
  try {
    if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") return;
    // Safe CSS colour grammar only: hex, or rgb()/rgba()/hsl()/hsla(). Anything
    // else (url(), expression(), keywords) is dropped — brand overrides are colours.
    const SAFE = /^#[0-9a-f]{3,8}$|^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s]+\)$/i;
    const decls = Object.entries(vars)
      .filter(([k, v]) => /^--[a-z0-9-]+$/i.test(k) && typeof v === "string" && SAFE.test(v.trim()))
      .map(([k, v]) => `${k}:${v.trim()};`)
      .join("");
    if (!decls) return;
    const style = document.createElement("style");
    style.setAttribute("data-ftd-brand", "1");
    style.textContent = ":root{" + decls + "}";
    document.head.appendChild(style);
  } catch {
    /* brand injection is non-fatal */
  }
}

export function createFunnel(config, mountEl, deps = {}) {
  const state = State.createState(config.id);

  // Executable schema (ADR-0009): if a schema is supplied, validate the config and
  // surface violations honestly. Non-blocking — the funnel still renders (the
  // decision core + trust gate catch fatal cases), but the contract breach is
  // logged and exposed via api.getValidation(). No schema → validation skipped.
  let validation = null;
  if (deps.schema) {
    validation = validateConfig(config, deps.schema);
    if (!validation.valid) {
      console.warn(`[ftd] config "${config.id}" failed schema validation:\n${formatValidationErrors(validation)}`);
    }
  }

  // Injected transport (tests) is used raw; otherwise leads fan out to every
  // configured destination — Google Sheets and/or a universal Webhook (GHL/Zapier/
  // CRMs) — wrapped in an offline outbox so a mid-submit network drop never loses
  // the lead and stranded leads are retried (ADR-0006 / ADR-0020).
  let leadSink = null;
  let submitLead;
  if (typeof deps.submitLead === "function") {
    submitLead = deps.submitLead;
  } else {
    const base = createLeadTransport({
      sheetsEndpoint: config.analytics?.sheetsEndpoint,
      webhookUrl: config.leadForm?.webhookUrl || config.analytics?.webhookEndpoint,
    }).submit;
    leadSink = createResilientSink(base, config.id);
    submitLead = leadSink.submit;
  }
  const theme = config.theme || null;
  loadTheme(theme);
  applyThemeVars(config.themeVars);

  // Analytics: init the bus and register any sinks the config asks for. Sink
  // registration is best-effort — a sink that fails to register must not stop
  // the funnel. With no configured sinks, emit() is a harmless no-op.
  analytics.initAnalytics(config.id);
  const _aSinks = config.analytics?.sinks || [];
  if (_aSinks.includes("sheets") && config.analytics?.sheetsEndpoint) {
    try { registerSheetsEventSink(config.analytics.sheetsEndpoint); } catch { /* non-fatal */ }
  }
  if (_aSinks.includes("ga4") && config.analytics?.ga4Id) {
    try { registerGa4Sink(config.analytics.ga4Id); } catch { /* non-fatal */ }
  }

  let view = "hero";
  let lastResolved = null;
  let leadHandle = null;
  let leadCaptured = false;

  /* ---------------------------------------------------------- rendering */

  function renderHero() {
    view = "hero";
    const h = config.hero || {};
    mount(
      mountEl,
      el("section", { class: "ftd-screen ftd-hero" }, [
        h.eyebrow ? el("p", { class: "ftd-hero-eyebrow", text: h.eyebrow }) : null,
        el("h1", { class: "ftd-hero-title" }, [
          document.createTextNode(h.headline || config.brand?.name || "التشخيص"),
          h.headlineAccent ? el("span", { class: "ftd-accent", text: " " + h.headlineAccent }) : null,
        ]),
        h.subtext ? el("p", { class: "ftd-hero-sub", text: h.subtext }) : null,
        h.chips?.length
          ? el("div", { class: "ftd-chips" }, h.chips.map((c) => el("span", { class: "ftd-chip", text: c })))
          : null,
        el("button", { class: "ftd-start", type: "button", onClick: start, text: h.startLabel || "ابدأ ←" }),
      ])
    );
  }

  function selectedOption(q) {
    return Flow.getOption(q, State.getAnswer(state, q.id));
  }

  function isLastFor(q) {
    return Flow.nextStepId(config, q.id, selectedOption(q)) === null;
  }

  function renderCurrentQuestion() {
    const q = Flow.getQuestion(config, state.currentStepId);
    if (!q) return finishQuestions();
    view = "question";
    const total = Flow.totalQuestions(config);
    const current = Flow.questionNumber(config, q.id);
    const label = (config.copy?.progressLabels || [])[current - 1] || "";
    mount(
      mountEl,
      renderQuestion(q, {
        selectedOptionId: State.getAnswer(state, q.id),
        isFirst: state.history.length === 0,
        isLast: isLastFor(q),
        current,
        total,
        label,
        lang: config.lang,
        onSelect: selectOption,
        onNext: goNext,
        onBack: goBack,
      })
    );
  }

  function showLead() {
    view = "lead";
    leadHandle = renderLeadCapture({
      config,
      onSubmit: async (values) => {
        const res = await submitLead(buildLeadPayload(values));
        const ok = !!(res && res.ok);
        analytics.emitLeadSubmitted(ok);
        if (ok) {
          leadCaptured = true;
          showResult();
        }
        return res || { ok: false };
      },
      onSkip: () => {
        analytics.emitLeadSkipped();
        showResult();
      },
    });
    mount(mountEl, leadHandle.node);
    analytics.emitLeadShown();
  }

  function showResult() {
    view = "result";
    if (!lastResolved) lastResolved = resolve(score(config, state.answers), config);
    mount(mountEl, renderResult({ resolved: lastResolved, config, answers: state.answers, onRestart: restart }));

    const sc = lastResolved.scoring || {};
    analytics.emitResultShown(lastResolved.primary?.id || null, lastResolved.secondary?.id || null, sc.flags || []);
    analytics.emitFunnelComplete(lastResolved.primary?.id || null, leadCaptured);
    _wireCtaAnalytics();
  }

  /**
   * Attach click tracking to the rendered CTAs. Browser-only: the Node test DOM
   * shim has no querySelectorAll, so this is skipped there (guarded) and never
   * throws — the funnel behaves identically with or without it.
   */
  function _wireCtaAnalytics() {
    if (!mountEl || typeof mountEl.querySelectorAll !== "function") return;
    const archetype = lastResolved?.primary?.id || null;
    mountEl.querySelectorAll(".ftd-cta, .ftd-card-cta").forEach((a) => {
      const ctaType = a.classList?.contains?.("ftd-card-cta") ? "secondary" : "primary";
      a.addEventListener("click", () => {
        analytics.emitCtaClicked(a.getAttribute("href") || "", archetype, ctaType);
      });
    });
  }

  /* ------------------------------------------------- payloads & control */

  function buildLeadPayload(values) {
    const sc = lastResolved.scoring;
    const payload = {
      type: "lead",
      funnelId: config.id,
      source: config.brand?.name || config.id,
      name: values.name || "",
      email: values.email || "",
      phone: values.phone || "",
      primaryArchetype: lastResolved.primary?.id || null,
      primaryArchetypeName: lastResolved.primary?.name || null,
      secondaryArchetype: lastResolved.secondary?.id || null,
      flags: sc.flags,
      scores: sc.scores,
      answers: state.answers,
      resultLayout: config.resultLayout,
      timestamp: new Date().toISOString(),
      dedupeKey: (values.email || "").trim().toLowerCase(),
    };
    // Conversion layer: for decision funnels, tag WHICH recommendation converted
    // (cert name) plus the derived signals + firing rule — so the lead is sales-actionable.
    if (config.scoring?.mode === "decision-table") {
      const built = buildRecommendations(lastResolved, sc, config);
      payload.recommended = built.primary?.name || null;
      payload.decisionRule = sc.ruleId || null;
      payload.signals = sc.signals || null;
    }
    return payload;
  }

  function finishQuestions() {
    // Compute the result once, before the lead step (so the lead is tagged).
    lastResolved = resolve(score(config, state.answers), config);
    const lf = config.leadForm || {};
    if (lf.gated && (lf.fields || []).length) showLead();
    else showResult();
  }

  function start() {
    // Flush any leads stranded by a previous session's network drop (best-effort).
    if (leadSink) leadSink.drain().catch(() => {});
    leadCaptured = false;
    state.currentStepId = Flow.firstStepId(config);
    state.history = [];
    State.save(state);
    analytics.emitQuizStart(theme);
    renderCurrentQuestion();
  }

  function selectOption(optionId) {
    const q = Flow.getQuestion(config, state.currentStepId);
    if (!q) return;
    State.setAnswer(state, q.id, optionId);
    State.save(state);
    analytics.emitQuestionAnswered(q.id, optionId, Flow.questionNumber(config, q.id));
    renderCurrentQuestion();
  }

  function goNext() {
    const q = Flow.getQuestion(config, state.currentStepId);
    if (!q || !State.getAnswer(state, q.id)) return;
    const nextId = Flow.nextStepId(config, q.id, selectedOption(q));
    state.history.push(q.id);
    State.save(state);
    if (nextId === null) finishQuestions();
    else {
      state.currentStepId = nextId;
      renderCurrentQuestion();
    }
  }

  function goBack() {
    if (state.history.length === 0) {
      renderHero();
      return;
    }
    const fromStep = state.currentStepId;
    state.currentStepId = state.history.pop();
    State.save(state);
    analytics.emitQuestionBack(fromStep, state.currentStepId);
    renderCurrentQuestion();
  }

  function restart() {
    State.reset(state);
    lastResolved = null;
    leadHandle = null;
    leadCaptured = false;
    analytics.emitRestart();
    renderHero();
  }

  /* -------------------------------------------------------------- init */

  renderHero();

  return {
    start,
    select: selectOption,
    next: goNext,
    back: goBack,
    restart,
    getView: () => view,
    getState: () => state,
    getResolved: () => lastResolved,
    getTheme: () => theme,
    // Schema-validation result ({valid, errors}), or null if no schema was supplied.
    getValidation: () => validation,
    // test/drive handle for the lead form (null unless on the lead step)
    getLeadHandle: () =>
      leadHandle && {
        fill: (vals) => {
          for (const k in vals) if (leadHandle.inputs[k]) leadHandle.inputs[k].value = vals[k];
          leadHandle.validate();
        },
        submit: () => leadHandle.submitBtn.click(),
        skip: () => leadHandle.skipBtn && leadHandle.skipBtn.click(),
        isSubmitDisabled: () => !!leadHandle.submitBtn.disabled,
      },
  };
}
