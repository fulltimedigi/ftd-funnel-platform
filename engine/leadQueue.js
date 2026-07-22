/**
 * engine/leadQueue.js — Offline outbox for leads (ADR-0006).
 * ---------------------------------------------------------------------------
 * The delivery-resilience layer. A lead must never be silently lost, and the
 * visitor must never be told it saved when it did not.
 *
 * The outbox holds ONLY leads that have not yet been confirmed sent. On submit
 * a lead is enqueued first (so a mid-submit network drop cannot lose it), then
 * sent; it is removed only when the transport accepts it (res.ok === true).
 * Leads the transport rejects — or a transport that throws — are KEPT and
 * retried later (at boot via drain(), and in a browser when `online` fires).
 *
 * This is separate from the sheets-sink audit log (`ftd:leads:<id>`), which is a
 * permanent record of every attempt. The outbox (`ftd_lead_outbox_<id>`) is the
 * transient retry queue.
 *
 * Host-agnostic: only `localStorage` (try/catch-guarded) and, optionally, a
 * guarded `window.addEventListener('online', …)` are touched. Safe under Node.
 * This module must never throw.
 */

const OUTBOX_PREFIX = "ftd_lead_outbox_";
const MAX_OUTBOX    = 50;

function _key(funnelId) {
  return OUTBOX_PREFIX + (funnelId || "default");
}

/** Identity of an outbox entry — used to de-dupe and to remove precisely. */
function _entryId(payload) {
  const who = payload.dedupeKey || payload.email || "anon";
  return `${who}|${payload.timestamp || ""}`;
}

function _read(funnelId) {
  try {
    const raw = globalThis.localStorage?.getItem(_key(funnelId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function _write(funnelId, list) {
  try {
    // Ring buffer: keep only the newest MAX_OUTBOX entries.
    globalThis.localStorage?.setItem(_key(funnelId), JSON.stringify(list.slice(-MAX_OUTBOX)));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Leads currently waiting to be delivered for this funnel. */
export function pendingLeads(funnelId) {
  return _read(funnelId);
}

/** Add a lead to the outbox (idempotent for an identical submit). */
export function enqueueLead(payload, funnelId) {
  if (!payload || typeof payload !== "object") return;
  const fid = funnelId || payload.funnelId;
  const list = _read(fid);
  const id = _entryId(payload);
  if (!list.some((e) => _entryId(e) === id)) list.push(payload);
  _write(fid, list);
}

/** Remove a specific lead from the outbox (call after a confirmed send). */
export function removeLead(payload, funnelId) {
  if (!payload || typeof payload !== "object") return;
  const fid = funnelId || payload.funnelId;
  const id = _entryId(payload);
  _write(fid, _read(fid).filter((e) => _entryId(e) !== id));
}

/**
 * Try to deliver every pending lead through `transport(payload) → {ok}`.
 * Removes only the ones the transport accepts; keeps the rest (honest — no
 * lead is dropped just because it could not be sent). Never throws.
 * @returns {Promise<{sent:number, kept:number, total:number}>}
 */
export async function drainOutbox(transport, funnelId) {
  const list = _read(funnelId);
  if (!list.length || typeof transport !== "function") {
    return { sent: 0, kept: list.length, total: list.length };
  }

  let sent = 0;
  const kept = [];
  for (const payload of list) {
    let res;
    try {
      res = await transport(payload);
    } catch {
      res = { ok: false, reason: "threw" };
    }
    if (res && res.ok) sent++;
    else kept.push(payload);
  }
  _write(funnelId, kept);
  return { sent, kept: kept.length, total: list.length };
}

/**
 * Wrap any transport so every submission is outbox-backed:
 *   enqueue → send → (on success) remove; (on failure) keep for a later drain.
 * `drain()` flushes leftovers (call at boot). In a browser it also re-drains
 * when connectivity returns. Under Node the `online` hook is skipped (guarded).
 *
 * @param {(payload:Object)=>Promise<{ok:boolean}>} transport
 * @param {string} funnelId
 */
export function createResilientSink(transport, funnelId) {
  async function submit(payload) {
    enqueueLead(payload, funnelId);
    let res;
    try {
      res = await transport(payload);
    } catch {
      res = { ok: false, reason: "threw" };
    }
    if (res && res.ok) removeLead(payload, funnelId);
    return res || { ok: false };
  }

  function drain() {
    return drainOutbox(transport, funnelId);
  }

  // Best-effort: retry stranded leads the moment the network returns.
  // Browser-only — guarded so Node (tests/SSR) installs nothing and never throws.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", () => { drain().catch(() => {}); });
  }

  return { submit, drain, pending: () => pendingLeads(funnelId) };
}
