/**
 * platform/publish.js — Pure publish-artifact builders (ADR-0022).
 * ---------------------------------------------------------------------------
 * Turns an approved funnel into the things a client actually takes away: the
 * hosted URL, the one-line embed snippet (ADR-0021), and a lead-sink wiring that
 * writes the chosen destination into the config (ADR-0020 guards reused). Pure —
 * no DOM, no network — so it is fully unit-tested.
 */

import { isUsableWebhook } from "../analytics/webhook-sink.js";

/** A funnel id safe for a URL/path segment: [a-z0-9-]. */
export function safeFunnelId(id) {
  return String(id || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function _origin(origin) {
  return String(origin || "").replace(/\/+$/, "");
}

/** The standalone hosted funnel URL (format #1). */
export function buildHostedUrl(origin, funnelId) {
  return _origin(origin) + "/embed/funnel.html?funnel=" + encodeURIComponent(safeFunnelId(funnelId));
}

/** The one-line embed the client pastes into their own site (format #2). */
export function buildEmbedSnippet(origin, funnelId) {
  const id = safeFunnelId(funnelId);
  return (
    '<div data-ftd-funnel="' + id + '"></div>\n' +
    '<script type="module" src="' + _origin(origin) + '/embed/embed.js"></script>'
  );
}

function _usableSheets(url) {
  return typeof url === "string" && url.trim().length > 0 && !url.trim().startsWith("PASTE_");
}

/**
 * Wire the operator-chosen lead sink into a copy of the config, honestly.
 * Returns { config, kinds } where kinds lists the destinations actually wired
 * (never claims a destination for a placeholder/empty value — rule 4).
 * @param {Object} config
 * @param {{webhookUrl?:string, sheetsEndpoint?:string}} sink
 */
export function applySink(config, sink = {}) {
  const next = JSON.parse(JSON.stringify(config || {}));
  next.leadForm = next.leadForm || {};
  next.analytics = next.analytics || {};
  const kinds = [];

  if (isUsableWebhook(sink.webhookUrl)) {
    next.leadForm.webhookUrl = sink.webhookUrl.trim();
    kinds.push("webhook");
  }
  if (_usableSheets(sink.sheetsEndpoint)) {
    next.analytics.sheetsEndpoint = sink.sheetsEndpoint.trim();
    const sinks = new Set(next.analytics.sinks || []);
    sinks.add("sheets");
    next.analytics.sinks = [...sinks];
    kinds.push("sheets");
  }
  return { config: next, kinds };
}

/**
 * Full publish artifact for an approved funnel. Pure assembler — the caller
 * (studio.publish) is responsible for gate checks BEFORE calling this.
 * @param {{origin:string, funnelId:string, config:Object, sink?:Object}} args
 */
export function buildArtifact({ origin, funnelId, config, sink }) {
  const id = safeFunnelId(funnelId);
  const wired = applySink(config, sink || {});
  return {
    funnelId: id,
    hostedUrl: buildHostedUrl(origin, id),
    embedSnippet: buildEmbedSnippet(origin, id),
    config: wired.config,
    sink: { kinds: wired.kinds },
  };
}
