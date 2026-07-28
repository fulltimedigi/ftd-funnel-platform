/**
 * engine/kernel/authoringOracle/poolRegistry.js — kernel-minted OPAQUE pools + AUTHORIZED edges (ADR-0046).
 * ===========================================================================================
 * SERVER-ONLY (node:crypto MAC). Two DISTINCT things, deliberately separated (consultation round-2, #3):
 *
 *   • A POOL authenticates MEMBERSHIP. Its ref/opaque_id is a pure function of (klass, members,
 *     evaluation_hash); near states legitimately SHARE a pool (same opaque_id). The pool MAC covers
 *     membership ONLY — tampering the roster breaks it (poison canary).
 *   • An EDGE authenticates AUTHORIZATION: "this child pool is a legitimate descendant of THIS parent
 *     via THIS minted transition." An edge is keyed by (parent_pool_ref, transition_ref) — NOT by the
 *     child's hash — so the SAME child state reached from two different parents yields TWO distinct
 *     edges. This is the fix for "first-write-wins by hash", which recorded a parent that may not be
 *     the one actually traversed and degraded the guarantee to "reached somehow" instead of "authorized".
 *
 * The browser runtime uses NEITHER: it consumes a CertifiedArtifact and re-verifies via the kernel on
 * load (no registry, no MAC, no shipped secret).
 */

import { createHmac, randomBytes } from "node:crypto";
import { poolRef } from "./hash.js";

const canonicalMembers = (m) => [...(m || [])].map(String).sort();

export class PoolRegistry {
  constructor(secret) {
    this._secret = secret || randomBytes(32); // per-session MAC secret — never leaves the server
    this._pools = new Map(); // ref → { klass, members, evaluation_hash, mac }
    this._edges = new Map();  // "parent::transition" → { parent_pool_ref, child_pool_ref, transition_ref, transition_kind, mac }
  }

  _mac(tag, fields) {
    return createHmac("sha256", this._secret).update(tag + ":" + JSON.stringify(fields)).digest("hex");
  }

  // ── POOLS (membership) ───────────────────────────────────────────────────────────────────────
  /** Mint (or return) an opaque pool. Identity = members; the MAC covers MEMBERSHIP only. */
  mintPool(klass, members, { evaluation_hash }) {
    const sorted = canonicalMembers(members);
    const ref = poolRef(klass, sorted, evaluation_hash);
    if (!this._pools.has(ref)) {
      const mac = this._mac("pool", { ref, klass, members: sorted, evaluation_hash });
      this._pools.set(ref, { klass, members: sorted, evaluation_hash, mac });
    }
    const p = this._pools.get(ref);
    return Object.freeze({ ref, mac: p.mac, klass, evaluation_hash });
  }

  /** SERVER-ONLY: resolve a ref to its member ids (certifier / differential use only). */
  resolve(ref) { const p = this._pools.get(ref); return p ? [...p.members] : null; }

  /** Verify a pool's MEMBERSHIP integrity. `override.members` simulates a poisoned roster (MAC rejects). */
  verifyPool(ref, override = {}) {
    const p = this._pools.get(ref);
    if (!p) return false;
    const members = override.members ? canonicalMembers(override.members) : p.members;
    return this._mac("pool", { ref, klass: p.klass, members, evaluation_hash: p.evaluation_hash }) === p.mac;
  }

  // ── EDGES (authorization) ──────────────────────────────────────────────────────────────────────
  /** Mint a transition edge. Keyed by (parent_pool_ref, transition_ref) — one receipt PER EDGE.
   *  C1 (round-3): the MAC also binds `child_evaluation_hash` + `context_ref` — pool identity by
   *  membership is weaker than evaluation identity (same members, different state/policy = different
   *  meaning), so the edge authorizes a specific CHILD EVALUATION under a specific CONTEXT, not just a roster. */
  mintEdge({ parent_pool_ref, child_pool_ref, transition_ref, transition_kind, child_evaluation_hash, context_ref }) {
    const key = parent_pool_ref + "::" + transition_ref;
    if (!this._edges.has(key)) {
      const rec = { parent_pool_ref, child_pool_ref, transition_ref, transition_kind, child_evaluation_hash: child_evaluation_hash || null, context_ref: context_ref || null };
      this._edges.set(key, { ...rec, mac: this._mac("edge", rec) });
    }
    const e = this._edges.get(key);
    return Object.freeze({ ref: key, mac: e.mac, parent_pool_ref, child_pool_ref, transition_ref, transition_kind, child_evaluation_hash: e.child_evaluation_hash, context_ref: e.context_ref });
  }

  /** SERVER-ONLY: every minted edge key — for the TREE-level bijection check (tree edges = minted edges). */
  allEdgeRefs() { return [...this._edges.keys()]; }

  /**
   * Verify an edge AUTHORIZES parent → child (a specific child evaluation + context) via the named
   * transition. `override` can substitute a forged field to prove the MAC catches an unauthorized path.
   */
  verifyEdge(receipt, override = {}) {
    if (!receipt || !receipt.ref) return false;
    const e = this._edges.get(receipt.ref);
    if (!e) return false;
    const fields = {
      parent_pool_ref: override.parent_pool_ref ?? e.parent_pool_ref,
      child_pool_ref: override.child_pool_ref ?? e.child_pool_ref,
      transition_ref: override.transition_ref ?? e.transition_ref,
      transition_kind: override.transition_kind ?? e.transition_kind,
      child_evaluation_hash: override.child_evaluation_hash ?? e.child_evaluation_hash,
      context_ref: override.context_ref ?? e.context_ref,
    };
    return this._mac("edge", fields) === e.mac;
  }
}

export default { PoolRegistry };
