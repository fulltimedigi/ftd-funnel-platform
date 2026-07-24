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
// COMPLETE MEDIATION (ADR-0037 P0): commercial rendering goes through the render-time reference
// monitor ONLY. verifyServedResult is no longer called here directly (the advisory/warn path is
// closed) — certifyForRender is the single fail-closed gate that mints a branded certificate or a
// terminal outcome; a product card/CTA is drawn only for a branded certificate.
import { certifyForRender, isCertified, clientVersionsOf } from "./kernel/certifyForRender.js";

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

/** Real product image, or a tasteful placeholder — never a fabricated image (ADR-0033). */
function productMedia(rec) {
  if (rec && rec.image) {
    return el("div", { class: "ftd-card-media" }, [
      el("img", { class: "ftd-card-img", src: rec.image, alt: rec.name || "", loading: "lazy" }),
    ]);
  }
  return el("div", { class: "ftd-card-media is-placeholder" }, [el("span", { class: "ftd-card-ph", text: "✦" })]);
}

/** Generic recommendation card. Same component for every vertical. */
function recommendationCard(rec, answers, config, opts = {}) {
  if (!rec) return null;
  const because = fillBecause(rec.becauseTemplate, answers, config);
  const shopLabel = resultCopy(config).shopLabel || "تسوّق الآن ←";
  const kids = [];
  if (opts.media !== false) kids.push(productMedia(rec));
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

/** Compact "you might also like" strip — real thumbnails, one tap to the product. Keeps
 *  the result decisive (one clear #1 above) while surfacing genuine nearest alternates. */
function altStrip(alts, config) {
  const title = resultCopy(config).contextualTitle || "قد يناسبك أيضاً";
  return el("div", { class: "ftd-alts" }, [
    el("h3", { class: "ftd-section-title", text: title }),
    el("div", { class: "ftd-alts-row" }, alts.map((a) =>
      el("a", { class: "ftd-alt", href: a.url, target: "_blank", rel: "noopener" }, [
        a.image
          ? el("img", { class: "ftd-alt-img", src: a.image, alt: a.name || "", loading: "lazy" })
          : el("div", { class: "ftd-alt-img is-placeholder" }, [el("span", { class: "ftd-card-ph", text: "✦" })]),
        el("span", { class: "ftd-alt-name", text: a.name }),
        a.price ? el("span", { class: "ftd-alt-price", text: a.price }) : null,
      ])
    )),
  ]);
}

/** Rule-level honesty (ADR-0036/0037): if the served result differs from any answer, say so
 *  plainly on the card — never a silent override. The disclosure is read from the KERNEL PROOF
 *  as STRUCTURED fields (conflicts vs unknowns get DISTINCT wording), not pre-authored prose, so
 *  mobile/i18n/a11y can never hide a compromise. A cheap runtime verifier (G2) first refuses to
 *  render if a never-relax constraint ever appears relaxed (a corrupted/stale table). */
function relaxNote(cert) {
  // Disclosure is read from the CERTIFICATE's structured fields (a card only ever renders for a
  // branded certificate, so there is no "verification failed" branch here — that path already
  // returned a terminal outcome and no card was drawn).
  if (!isCertified(cert)) return null;
  const conflicts = cert.conflicts || [];
  const unknowns = cert.unknowns || [];
  if (!conflicts.length && !unknowns.length) return null;

  const parts = [];
  for (const r of conflicts) {
    if (r.advisory) parts.push("حسب تفضيلك تميل لـ«" + (r.label || r.axis) + "» — راعيناه قدر المتاح");
    else if (r.dir === "above") parts.push("أعلى قليلاً من الميزانية المختارة");
    else if (r.dir === "below") parts.push("أقل من الميزانية المختارة");
    else parts.push("يختلف في: " + (r.label || r.axis));
  }
  // UNKNOWN reads differently from a conflict: we couldn't CONFIRM it (not "it's wrong").
  for (const u of unknowns) parts.push((u.advisory ? "تفضيل غير مؤكّد: " : "لم نتمكّن من تأكيد: ") + (u.label || u.axis));

  return el("div", { class: "ftd-relax" }, [
    el("span", { class: "ftd-relax-ic", text: "ℹ︎" }),
    el("span", { class: "ftd-relax-txt", text: " أقرب اختيار متاح — " + parts.join(" · ") + "." }),
  ]);
}

/** A first-class TERMINAL screen — NO product card, NO CTA (ADR-0037 P0 complete mediation). */
function renderTerminal(cert, config, onRestart, copy) {
  const kind = (cert && cert.terminal) || "NO_MATCH";
  const MSG = {
    NO_MATCH: "لا يوجد منتج يطابق اختياراتك تمامًا الآن. جرّب إجابات مختلفة.",
    STALE: "تحدّثت بيانات المتجر منذ أن بدأت. من فضلك ابدأ من جديد لضمان نتيجة دقيقة.",
    RESTART_REQUIRED: "لم نتمكّن من قراءة إجاباتك كاملة. من فضلك ابدأ من جديد.",
    HANDOFF_UNBOUND: "المنتج المطابق غير متاح للشراء المباشر الآن.",
    INVALID_ARTIFACT: "حدث خطأ في التحقق من النتيجة. من فضلك ابدأ من جديد.",
  };
  return el("section", { class: "ftd-screen ftd-result ftd-result-terminal", "data-terminal": kind }, [
    config.brand?.logo ? el("div", { class: "ftd-brandbar is-result" }, [el("img", { class: "ftd-logo", src: config.brand.logo, alt: config.brand?.name || "", loading: "lazy" })]) : null,
    el("div", { class: "ftd-terminal-card" }, [
      el("div", { class: "ftd-terminal-ic", text: "🔎" }),
      el("p", { class: "ftd-terminal-msg", text: MSG[kind] || MSG.NO_MATCH }),
    ]),
    restartButton(config, onRestart),
  ]);
}

function renderCommerce(ctx) {
  const { resolved, config, answers, onRestart } = ctx;
  const { primary, secondary, proportion } = resolved;
  const extras = primary?.resultExtras || {};
  const copy = resultCopy(config);
  const rcopy = copy; // result-scoped copy aliases below
  const lang = config.lang;

  // COMPLETE MEDIATION (ADR-0037 P0): mint a certificate or a terminal outcome for THIS path. A
  // product card / CTA is drawn ONLY for a branded certificate; anything else draws a terminal
  // screen (no card, no CTA). For decision funnels the client echoes the served version stamps; a
  // real deployment substitutes what the browser actually loaded (any drift → STALE terminal).
  const isDecision = config.scoring?.mode === "decision-table";
  // The reference monitor gates KERNEL-AUTHORED funnels (those carrying ProvenSelections). Curated
  // hand-built reference configs (no proofs) predate the kernel and render on the legacy path — they
  // are trusted through trust + anti-bland, not the render certificate. Every AUTHORED commercial
  // funnel (the AI / deterministic pipeline) is kernel-authored and IS completely mediated here.
  const isKernelAuthored = isDecision && ((config.decisionTable || []).some((r) => r.proof) || !!config.constraintPolicy);
  const cert = isKernelAuthored ? certifyForRender(config, resolved, answers, ctx.clientVersions || clientVersionsOf(config)) : null;
  if (isKernelAuthored && !isCertified(cert)) {
    return renderTerminal(cert, config, onRestart, copy);
  }

  // Decision-table funnels carry the Step-8 explanation engine (signal-gated why/why-not).
  const built = isDecision ? buildRecommendations(resolved, resolved.scoring, config) : null;

  const children = [
    config.brand?.logo ? el("div", { class: "ftd-brandbar is-result" }, [el("img", { class: "ftd-logo", src: config.brand.logo, alt: config.brand?.name || "", loading: "lazy" })]) : null,
    heroCard(primary, copy.eyebrow || "بروفايلك"),
    primary?.description ? el("p", { class: "ftd-result-desc", text: primary.description }) : null,
    traitsBlock(primary),
    blendBlock(primary, secondary, proportion, lang),
  ];

  // Signature recommendation. For decision funnels EVERY commercial field (title/image/price/url and
  // the CTA) comes from the CERTIFICATE's CanonicalOfferRecord — the proven SKU — never composited.
  const recs = primary?.recommendations || {};
  const sig = cert
    ? { ...(built ? built.primary : {}), name: cert.offer.title || (built && built.primary && built.primary.name), url: cert.cta_url, price: cert.offer.price, image: cert.offer.image }
    : (built ? built.primary : recs.primary);
  const sigOk = cert ? true : (sig && fillBecause(sig.becauseTemplate, answers, config));
  if (sigOk && sig) {
    children.push(
      el("div", { class: "ftd-signature" }, [
        el("h3", { class: "ftd-section-title", text: copy.recommendationTitle || "توصيتنا" }),
        recommendationCard(sig, answers, config, { showCta: true, highlight: true, badge: config.decisiveResult ? (copy.bestBadge || "✦ الأنسب لك") : null }),
        cert ? relaxNote(cert) : null,
      ])
    );
  }

  // DECISIVE mode (UX_INTERFACE_DECISION §6): exactly one pick + 2–3 grounded
  // reasons + exactly one CTA (the product card's, to a real URL). No "why not",
  // no contextual grid, no second CTA — zero distraction. Opt-in per config so
  // reference funnels keep their richer layout; our authoring turns it on.
  const decisive = config.decisiveResult === true;

  // Why it fits / why not the alternatives / next step (the value layer).
  if (built && built.primary) {
    const why = decisive ? (built.primary.why || []).slice(0, 3) : built.primary.why;
    children.push(reasonList(rcopy.whyTitle || "لماذا تناسبك", why, "is-why"));
    if (!decisive) {
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
  }

  if (!decisive) {
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

    children.push(ctaLink(config)); // decisive keeps only the product card CTA above
  }

  // Decisive mode: a compact strip of real nearest alternates. For decision funnels these come ONLY
  // from the certificate's INDEPENDENTLY-CERTIFIED alternates (audit #8) — an uncertified alternate
  // is never drawn; each renders from its own CanonicalOfferRecord (never composited).
  if (decisive) {
    const alts = cert
      ? cert.alternates.slice(0, 3).map((c) => ({ name: c.offer.title, url: c.cta_url, price: c.offer.price, image: c.offer.image }))
      : (recs.contextual || []).slice(0, 3);
    if (alts.length) children.push(altStrip(alts, config));
  }

  children.push(restartButton(config, onRestart));
  return el("section", { class: "ftd-screen ftd-result ftd-result-commerce" }, children);
}

/* ------------------------------------------------------------ personas */

/** One titled persona list (strengths / gaps / actions). Null when empty. */
function personaList(icon, title, className, items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return el("div", { class: "ftd-persona-section " + className }, [
    el("div", { class: "ftd-persona-head" }, [
      el("span", { class: "ftd-persona-icon", text: icon }),
      el("h3", { class: "ftd-persona-title", text: title }),
    ]),
    el("ul", { class: "ftd-persona-list" }, items.map((it) => el("li", { class: "ftd-persona-item", text: it }))),
  ]);
}

/**
 * Personas layout — a coaching / B2B profile: who you are (hero + traits +
 * blend) then strengths / gaps / next-steps from the archetype's resultExtras,
 * and the primary recommendation (only when its `because` resolves — same §9
 * rule as every layout). Lists are omitted when absent (no fabrication).
 */
function renderPersonas(ctx) {
  const { resolved, config, answers, onRestart } = ctx;
  const { primary, secondary, proportion } = resolved;
  const extras = primary?.resultExtras || {};
  const copy = resultCopy(config);
  const lang = config.lang;

  const children = [
    heroCard(primary, copy.eyebrow || "نتيجتك"),
    primary?.description ? el("p", { class: "ftd-result-desc", text: primary.description }) : null,
    traitsBlock(primary),
    blendBlock(primary, secondary, proportion, lang),
    personaList("💪", copy.strengthsTitle || "نقاط القوة", "ftd-strengths", extras.strengths),
    personaList("🎯", copy.gapsTitle || "مجالات التطوير", "ftd-gaps", extras.gaps),
    personaList("✅", copy.actionsTitle || "الخطوات التالية", "ftd-actions", extras.actions),
  ];

  // Primary recommendation — only if its `because` resolves from the answers.
  const rec = primary?.recommendations?.primary;
  if (rec && fillBecause(rec.becauseTemplate, answers, config)) {
    children.push(
      el("div", { class: "ftd-rec" }, [
        el("h3", { class: "ftd-rec-title", text: copy.recommendationTitle || "توصيتنا لك" }),
        recommendationCard(rec, answers, config, { showCta: true }),
      ])
    );
  }

  children.push(ctaLink(config));
  children.push(restartButton(config, onRestart));
  return el("section", { class: "ftd-screen ftd-result ftd-result-personas" }, children);
}

/* ----------------------------------------------------------- dispatch */

export function renderResult(ctx) {
  const layout = ctx.config.resultLayout || "tracks";
  switch (layout) {
    case "commerce":
      return renderCommerce(ctx);
    case "personas":
      return renderPersonas(ctx);
    case "tracks":
    default:
      return renderTracks(ctx);
  }
}
