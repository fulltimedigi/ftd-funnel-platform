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
 *   shown. NO analytics events, NO themes yet.
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
import { createSheetsSink } from "../analytics/sheets-sink.js";

export async function boot({ configUrl, mountEl }) {
  const res = await fetch(configUrl);
  const config = await res.json();
  return createFunnel(config, mountEl);
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

export function createFunnel(config, mountEl, deps = {}) {
  const state = State.createState(config.id);
  const submitLead = deps.submitLead || createSheetsSink(config.analytics?.sheetsEndpoint).submit;
  const theme = config.theme || null;
  loadTheme(theme);

  let view = "hero";
  let lastResolved = null;
  let leadHandle = null;

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
        if (res && res.ok) showResult();
        return res || { ok: false };
      },
      onSkip: showResult,
    });
    mount(mountEl, leadHandle.node);
  }

  function showResult() {
    view = "result";
    if (!lastResolved) lastResolved = resolve(score(config, state.answers), config);
    mount(mountEl, renderResult({ resolved: lastResolved, config, answers: state.answers, onRestart: restart }));
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
    state.currentStepId = Flow.firstStepId(config);
    state.history = [];
    State.save(state);
    renderCurrentQuestion();
  }

  function selectOption(optionId) {
    const q = Flow.getQuestion(config, state.currentStepId);
    if (!q) return;
    State.setAnswer(state, q.id, optionId);
    State.save(state);
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
    state.currentStepId = state.history.pop();
    State.save(state);
    renderCurrentQuestion();
  }

  function restart() {
    State.reset(state);
    lastResolved = null;
    leadHandle = null;
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
