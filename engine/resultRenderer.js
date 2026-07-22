/**
 * engine/resultRenderer.js — Result rendering (generic, config-driven).
 *
 * Responsibility (SPEC §5, §9):
 *   Dispatch on config.resultLayout and render the result. All layouts are
 *   GENERIC — they read content from the config/archetype, never from any
 *   vertical-specific knowledge baked into this file.
 *
 *   Layouts:
 *     - "tracks"   : details + score-distribution bars (assessment/education)
 *     - "commerce" : signature recommendation + contextual product grid (retail)
 *     - "personas" : (falls back to tracks for now)
 *
 *   Shared building blocks: hero card, blend line, traits, and a single generic
 *   recommendation card (name/notes/because/price/CTA) reused by both layouts.
 *
 * RULE (SPEC §9): the primary recommendation renders only if its `because`
 *   resolves from the user's answers.
 *
 * ctx = { resolved, config, answers, onRestart }
 */

import { el } from "./dom.js";
import { buildRecommendations } from "./recommend.js";
import { localizeNum, formatPercent } from "./i18n-rtl.js";

/* ----------------------------------------------------------- helpers */

/** Fill {questionId} tokens in a because-template with chosen option labels. */
function fillBecause(template, answers, config) {
  if (!template) return "";
  let unresolved = false;
  const out = template.replace(/\{([A-Za-z0-9_]+)\}/g, (m, qid) => {
    const q = (config.questions || []).find((x) => x.id === qid);
    const o = q && (q.options || []).find((x) => x.id === answers[qid]);
    if (!o) { unresolved = true; return m; }
    return o.label;
  });
  return unresolved ? "" : out;
}

function resultCopy(config) {
  return (config.copy && config.copy.result) || {};
}

/** Generic recommendation card. Same component for every vertical. */
function recommendationCard(rec, answers, config, opts = {}) {
  if (!rec) return null;
  const because = fillBecause(rec.becauseTemplate, answers, config);
  const shopLabel = resultCopy(config).shopLabel || "تسوّق الآن ←";
  const kids = [];
  if (opts.badge) kids.push(el("span", { class: "ftd-card-badge", text: opts.badge }));
  if (rec.tag) kids.push(el("p", { class: "ftd-card-tag", text: rec.tag }));
  kids.push(el("p", { class: "ftd-card-name", text: rec.name }));
  if (rec.nameSecondary) kids.push(el("p", { class: "ftd-card-name2", text: rec.nameSecondary }));
  if (rec.notes) kids.push(el("p", { class: "ftd-card-notes", text: rec.notes }));
  if (because) kids.push(el("p", { class: "ftd-card-because", text: because }));
  if (rec.price) {
    kids.push(
      el("div", { class: "ftd-price" }, [
        el("span", { class: "ftd-price-sale", text: rec.price }),
        rec.originalPrice ? el("span", { class: "ftd-price-orig", text: rec.originalPrice }) : null,
        rec.discountLabel ? el("span", { class: "ftd-price-badge", text: rec.discountLabel }) : null,
      ])
    );
  }
  if (opts.showCta && rec.url) {
    kids.push(el("a", { class: "ftd-card-cta", href: rec.url, target: "_blank", rel: "noopener", text: shopLabel }));
  }
  return el("div", { class: "ftd-card" + (opts.highlight ? " is-highlight" : "") }, kids);
}

function heroCard(primary, eyebrow) {
  return el("div", { class: "ftd-result-hero" }, [
    primary?.icon ? el("div", { class: "ftd-result-icon", text: primary.icon }) : null,
    el("p", { class: "ftd-result-eyebrow", text: eyebrow }),
    el("h2", { class: "ftd-result-name", text: primary?.name || "—" }),
    primary?.tagline ? el("p", { class: "ftd-result-tagline", text: primary.tagline }) : null,
  ]);
}

function traitsBlock(primary) {
  if (!primary?.traits?.length) return null;
  return el("div", { class: "ftd-traits" }, primary.traits.map((t) => el("span", { class: "ftd-trait", text: t })));
}

function blendBlock(primary, secondary, proportion, lang) {
  if (!secondary) return null;
  return el("p", {
    class: "ftd-blend",
    text: `أنت في الأساس ${primary.name} (${formatPercent(proportion.primaryPct, lang)})، مع لمسة من ${secondary.name} (${formatPercent(proportion.secondaryPct, lang)}).`,
  });
}

function restartButton(config, onRestart) {
  return el("button", {
    class: "ftd-restart",
    type: "button",
    onClick: onRestart,
    text: config.copy?.restartLabel || "↺ ابدأ من جديد",
  });
}

function ctaLink(config) {
  if (!config.cta?.primaryUrl) return null;
  return el("a", {
    class: "ftd-cta",
    href: config.cta.primaryUrl,
    target: "_blank",
    rel: "noopener",
    text: config.cta.primaryLabel || "ابدأ الآن ←",
  });
}

/* ----------------------------------------------------------- layouts */

function renderTracks(ctx) {
  const { resolved, config, answers, onRestart } = ctx;
  const { primary, secondary, proportion, scoring } = resolved;
  const archById = new Map((config.archetypes || []).map((a) => [a.id, a]));
  const extras = primary?.resultExtras || {};
  const copy = resultCopy(config);
  const lang = config.lang;

  const children = [
    heroCard(primary, copy.eyebrow || "نتيجتك"),
    primary?.description ? el("p", { class: "ftd-result-desc", text: primary.description }) : null,
    traitsBlock(primary),
    blendBlock(primary, secondary, proportion, lang),
  ];

  // Details
  const detail = [];
  if (extras.step) detail.push(["🚀 أول خطوة", extras.step]);
  if (extras.time) detail.push(["⏱ أول عميل خلال", extras.time]);
  if (extras.earn) detail.push(["💰 العائد المتوقع", extras.earn]);
  if (extras.platforms?.length) detail.push(["🌐 أفضل المنصات", extras.platforms.join(" · ")]);
  if (detail.length) {
    children.push(
      el("div", { class: "ftd-details" }, detail.map(([k, v]) =>
        el("div", { class: "ftd-detail" }, [
          el("span", { class: "ftd-detail-k", text: k }),
          el("span", { class: "ftd-detail-v", text: v }),
        ])
      ))
    );
  }

  // Primary recommendation (only if `because` resolves)
  const rec = primary?.recommendations?.primary;
  if (rec && fillBecause(rec.becauseTemplate, answers, config)) {
    children.push(
      el("div", { class: "ftd-rec" }, [
        el("h3", { class: "ftd-rec-title", text: copy.recommendationTitle || "توصيتنا لك" }),
        recommendationCard(rec, answers, config, { showCta: false }),
      ])
    );
  }

  // Score distribution
  const maxScore = Math.max(1, ...scoring.sorted.map(([, v]) => v));
  const bars = scoring.sorted.map(([id, v]) => {
    const a = archById.get(id);
    const pct = Math.round((v / maxScore) * 100);
    return el("div", { class: "ftd-bar-row" }, [
      el("span", { class: "ftd-bar-name", text: (a?.icon ? a.icon + " " : "") + (a?.name || id) }),
      el("div", { class: "ftd-bar-track" }, [el("div", { class: "ftd-bar-fill", style: `width:${pct}%` })]),
      el("span", { class: "ftd-bar-val", text: localizeNum(v, lang) }),
    ]);
  });
  children.push(
    el("div", { class: "ftd-bars" }, [
      el("h3", { class: "ftd-bars-title", text: copy.scoreTitle || "📊 توزيع نتيجتك على المسارات" }),
      ...bars,
    ])
  );

  children.push(ctaLink(config));
  children.push(restartButton(config, onRestart));
  return el("section", { class: "ftd-screen ftd-result ftd-result-tracks" }, children);
}

/** Reason list: "why it fits" / "why not the alternatives" (Rules 9/10). */
function reasonList(title, bullets, cls) {
  if (!bullets || !bullets.length) return null;
  return el("div", { class: "ftd-reasons " + cls }, [
    el("h3", { class: "ftd-section-title", text: title }),
    el("ul", { class: "ftd-reason-list" },
      bullets.map((b) =>
        el("li", { class: "ftd-reason" }, [
          b.name ? el("span", { class: "ftd-reason-name", text: b.name + ": " }) : null,
          document.createTextNode(b.text),
        ])
      )
    ),
  ]);
}

function renderCommerce(ctx) {
  const { resolved, config, answers, onRestart } = ctx;
  const { primary, secondary, proportion } = resolved;
  const extras = primary?.resultExtras || {};
  const copy = resultCopy(config);
  const rcopy = copy; // result-scoped copy aliases below
  const recs = primary?.recommendations || {};
  const lang = config.lang;

  // Decision-table funnels carry the Step-8 explanation engine (signal-gated
  // why/why-not, variant-correct recommendation). Generic funnels keep the
  // legacy answer-label path.
  const built = config.scoring?.mode === "decision-table" ? buildRecommendations(resolved, resolved.scoring, config) : null;

  const children = [
    heroCard(primary, copy.eyebrow || "بروفايلك"),
    primary?.description ? el("p", { class: "ftd-result-desc", text: primary.description }) : null,
    traitsBlock(primary),
    blendBlock(primary, secondary, proportion, lang),
  ];

  // Signature recommendation: variant-resolved for decision funnels.
  const sig = built ? built.primary : recs.primary;
  const sigOk = built ? !!built.primary : sig && fillBecause(sig.becauseTemplate, answers, config);
  if (sigOk) {
    children.push(
      el("div", { class: "ftd-signature" }, [
        el("h3", { class: "ftd-section-title", text: copy.recommendationTitle || "توصيتنا" }),
        recommendationCard(sig, answers, config, { showCta: true, highlight: true }),
      ])
    );
  }

  // Why it fits / why not the alternatives / next step (the value layer).
  if (built && built.primary) {
    children.push(reasonList(rcopy.whyTitle || "لماذا تناسبك", built.primary.why, "is-why"));
    children.push(reasonList(rcopy.whyNotTitle || "لماذا ليست البدائل", built.primary.whyNot, "is-whynot"));
    if (built.primary.nextAction) {
      children.push(
        el("div", { class: "ftd-next" }, [
          el("h3", { class: "ftd-section-title", text: rcopy.nextTitle || "الخطوة التالية" }),
          el("p", { class: "ftd-next-action", text: built.primary.nextAction }),
        ])
      );
    }
  }

  // Expert tip (generic: archetype.resultExtras.tip)
  if (extras.tip) {
    children.push(el("p", { class: "ftd-tip", text: "💡 " + extras.tip }));
  }

  // Contextual recommendation grid (gated for decision funnels, raw otherwise).
  const contextual = built ? built.contextual : recs.contextual || [];
  if (contextual.length) {
    children.push(el("h3", { class: "ftd-section-title", text: copy.contextualTitle || "توصيات إضافية" }));
    const cards = contextual.map((rec, i) =>
      recommendationCard(rec, answers, config, {
        showCta: true,
        highlight: i === 0,
        badge: i === 0 ? copy.bestForYou || null : null,
      })
    );
    children.push(el("div", { class: "ftd-grid" }, cards));
  }

  children.push(ctaLink(config));
  children.push(restartButton(config, onRestart));
  return el("section", { class: "ftd-screen ftd-result ftd-result-commerce" }, children);
}

/* ----------------------------------------------------------- dispatch */

export function renderResult(ctx) {
  const layout = ctx.config.resultLayout || "tracks";
  switch (layout) {
    case "commerce":
      return renderCommerce(ctx);
    case "tracks":
    case "personas": // personas variant not built yet — falls back to tracks
    default:
      return renderTracks(ctx);
  }
}
