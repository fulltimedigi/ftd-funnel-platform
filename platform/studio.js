/**
 * platform/studio.js — Funnel-project lifecycle (ADR-0022).
 * ---------------------------------------------------------------------------
 * The heart of the SaaS flow, as deterministic code:
 *
 *   draft ──generate──▶ in-review ──refine*──▶ ──publish──▶ published
 *                   └▶ blocked (authoring failed OR a gate failed)
 *
 * Two hard rules baked in (rule 3 / anti-bland standard):
 *   • A funnel that fails trustValidate OR antiBlandCheck NEVER reaches review —
 *     it is honestly `blocked`, with the gate findings attached so the operator
 *     sees why.
 *   • refine() re-runs BOTH gates and ACCEPTS ONLY IF BOTH PASS; a refine that
 *     would break a gate is refused and the project is left untouched. The gate
 *     is never weakened to accept an edit.
 *
 * Pure over plain project objects (each op returns a NEW project) and Node-safe:
 * authoring is INJECTED (default = the real generateFunnelFromUrl / a re-author
 * adapter), so the whole flow runs offline and deterministically in tests. The
 * caller persists the returned project via tenantStore — studio touches no store.
 */

import { generateFunnelFromUrl } from "../authoring/index.js";
import { authorFunnel } from "../authoring/author/index.js";
import { trustValidate } from "../engine/trustValidate.js";
import { antiBlandCheck } from "../authoring/author/qualityGate.js";
import { buildArtifact } from "./publish.js";

/** Knobs that genuinely re-author today (honest — no no-op knobs advertised). */
const LIVE_KNOBS = ["brandName", "theme", "lang", "sheetsEndpoint"];

/** Default re-author adapter: re-run authoring from a stored catalog + re-gate. */
function defaultReauthor(catalog, opts) {
  const a = authorFunnel({ products: catalog.products, origin: catalog.origin, brandUrl: catalog.brandUrl }, opts);
  if (!a.ok) return { ok: false, reason: a.reason, meta: a.meta };
  return { ok: true, config: a.config, trust: trustValidate(a.config), bland: antiBlandCheck(a.config), meta: a.meta };
}

function _gatesGreen(gates) {
  return !!(gates && gates.trust && gates.trust.ok && gates.bland && gates.bland.ok);
}

/** A fresh draft project (not yet persisted — the caller stores it). */
export function createDraft({ tenantId, url, goal }) {
  if (!tenantId) throw new Error("studio: tenantId required");
  if (!url) throw new Error("studio: brand url required");
  return {
    tenantId,
    brandUrl: url,
    goal: goal || null,
    status: "draft",
    config: null,
    catalog: null,
    gates: null,
    knobs: {},
    blockedReason: null,
    artifact: null,
    history: ["draft"],
  };
}

/**
 * Run server-side authoring for a draft. Returns a new project:
 *   ok + both gates green → in-review (config, catalog, gates attached)
 *   authoring failed       → blocked (stage:reason)
 *   a gate failed          → blocked ('failed-gate', gates+config attached to explain)
 * @param {Object} project
 * @param {{generate?: (url,opts)=>Promise<Object>}} [deps]
 */
export async function generate(project, deps = {}) {
  if (project.status !== "draft" && project.status !== "blocked") {
    return { ...project };
  }
  const gen = typeof deps.generate === "function" ? deps.generate : generateFunnelFromUrl;
  const opts = { goal: project.goal || undefined, ...project.knobs };
  const res = await gen(project.brandUrl, opts);

  if (!res || !res.ok) {
    return {
      ...project, status: "blocked",
      blockedReason: (res && (res.stage ? res.stage + ":" + res.reason : res.reason)) || "authoring-failed",
      history: [...project.history, "blocked"],
    };
  }

  const gates = { trust: res.trust, bland: res.bland };
  const catalog = res.catalog ? { ...res.catalog, brandUrl: project.brandUrl } : null;

  if (!_gatesGreen(gates)) {
    // Honest: a funnel that fails a gate is a finding, not a publishable draft.
    return {
      ...project, status: "blocked", blockedReason: "failed-gate",
      config: res.config || null, catalog, gates, meta: res.meta || null,
      history: [...project.history, "blocked"],
    };
  }

  return {
    ...project, status: "in-review",
    config: res.config, catalog, gates, meta: res.meta || null, blockedReason: null,
    history: [...project.history, "in-review"],
  };
}

/**
 * Apply the operator's knobs and re-author from the stored catalog. Accepts the
 * edit ONLY if both gates pass; otherwise the project is returned UNCHANGED with
 * a refusal — the gate is never weakened to make a refine land.
 * @returns {{ok:boolean, project:Object, reason?:string, gates?:Object}}
 */
export function refine(project, knobs = {}, deps = {}) {
  if (project.status !== "in-review") return { ok: false, reason: "not-in-review", project: { ...project } };
  if (!project.catalog) return { ok: false, reason: "no-catalog", project: { ...project } };

  const reauthor = typeof deps.reauthor === "function" ? deps.reauthor : defaultReauthor;
  const mergedKnobs = { ...project.knobs };
  for (const k of LIVE_KNOBS) if (k in knobs) mergedKnobs[k] = knobs[k];
  const nextGoal = "goal" in knobs ? knobs.goal : project.goal;

  const res = reauthor(project.catalog, { goal: nextGoal || undefined, ...mergedKnobs });
  if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || "reauthor-failed", project: { ...project } };

  const gates = { trust: res.trust, bland: res.bland };
  if (!_gatesGreen(gates)) {
    // Refuse the edit — keep the last good draft, surface why it was rejected.
    return { ok: false, reason: "failed-gate", gates, project: { ...project } };
  }

  return {
    ok: true,
    project: {
      ...project, config: res.config, gates, knobs: mergedKnobs, goal: nextGoal || null,
      history: [...project.history, "refined"],
    },
  };
}

/**
 * Emit the publish artifact for an in-review, gate-green funnel and mark it
 * published. Honest refusal otherwise (never a fake "published").
 * @param {Object} project
 * @param {{origin:string, sink?:{webhookUrl?:string, sheetsEndpoint?:string}}} args
 * @returns {{ok:boolean, project:Object, artifact?:Object, reason?:string}}
 */
export function publish(project, { origin, sink } = {}) {
  if (project.status !== "in-review") return { ok: false, reason: "not-in-review", project: { ...project } };
  if (!_gatesGreen(project.gates)) return { ok: false, reason: "failed-gate", project: { ...project } };
  if (!origin) return { ok: false, reason: "no-origin", project: { ...project } };
  if (!project.config) return { ok: false, reason: "no-config", project: { ...project } };

  const funnelId = project.tenantId + "-" + (project.config.id || "funnel");
  const artifact = buildArtifact({ origin, funnelId, config: project.config, sink });

  return {
    ok: true,
    artifact,
    project: {
      ...project, status: "published",
      artifact: { funnelId: artifact.funnelId, hostedUrl: artifact.hostedUrl, embedSnippet: artifact.embedSnippet, sink: artifact.sink },
      history: [...project.history, "published"],
    },
  };
}
