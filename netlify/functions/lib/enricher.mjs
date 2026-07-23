/**
 * netlify/functions/lib/enricher.mjs — build the AI enricher for the functions.
 * Shared by the sync generate function and the background job (ADR-0028/0029).
 * Only when ANTHROPIC_API_KEY is set (a server secret); else undefined → honest
 * deterministic fallback. Design model: claude-opus-4-8.
 */

import { enrichAuthor } from "../../../authoring/ai/enrichAuthor.js";
import { createAnthropicComplete } from "../../../authoring/ai/complete.js";

export function buildEnricher() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return undefined;
  const complete = createAnthropicComplete({ apiKey: key });
  return (catalog, ctx) => enrichAuthor(catalog, { ...ctx, complete });
}
