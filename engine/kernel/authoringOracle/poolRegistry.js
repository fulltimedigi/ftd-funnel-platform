/**
 * engine/kernel/authoringOracle/poolRegistry.js — kernel-minted OPAQUE pools with LINEAGE (ADR-0046).
 * ===========================================================================================
 * SERVER-ONLY (uses node:crypto for the MAC). Pools are MINTED here, never assembled by the brain —
 * an id-set is itself a manipulation channel, so the brain receives an opaque `ref` and a `count`,
 * never a roster. Every minted pool carries a LINEAGE receipt MAC'd under a per-session secret:
 *   { ref, klass, members, evaluation_hash, parent_ref, transition_kind } → HMAC.
 * Tampering the membership (or any lineage field) breaks the MAC — a poison canary. `resolve()` is a
 * server-only escape hatch (used by the certifier / differential), never handed to the brain.
 *
 * The browser runtime does NOT use this registry: it consumes a CertifiedArtifact and re-verifies via
 * the kernel on load (no registry, no MAC, no shipped secret) — see certified-pipeline-contract.md.
 */

import { createHmac, randomBytes } from "node:crypto";
import { poolRef } from "./hash.js";

function canonicalMembers(members) {
  return [...(members || [])].map(String).sort();
}

export class PoolRegistry {
  constructor(secret) {
    this._secret = secret || randomBytes(32); // per-session MAC secret — never leaves the server
    this._pools = new Map();                  // ref → { klass, members, evaluation_hash, parent_ref, transition_kind, mac }
  }

  _mac(fields) {
    const h = createHmac("sha256", this._secret);
    h.update(JSON.stringify(fields));
    return h.digest("hex");
  }

  /** Mint (or return the already-minted) opaque pool. Deterministic ref = poolRef(klass, ids, hash). */
  mint(klass, members, { evaluation_hash, parent_ref = null, transition_kind = "ROOT" }) {
    const sorted = canonicalMembers(members);
    const ref = poolRef(klass, sorted, evaluation_hash);
    if (this._pools.has(ref)) return this._pools.get(ref).receipt;
    const macFields = { ref, klass, members: sorted, evaluation_hash, parent_ref, transition_kind };
    const mac = this._mac(macFields);
    const receipt = Object.freeze({ ref, mac, klass, evaluation_hash, parent_ref, transition_kind });
    this._pools.set(ref, { klass, members: sorted, evaluation_hash, parent_ref, transition_kind, mac, receipt });
    return receipt;
  }

  /** SERVER-ONLY: resolve a ref back to its member ids (certifier / differential use only). */
  resolve(ref) {
    const p = this._pools.get(ref);
    return p ? [...p.members] : null;
  }

  /**
   * Verify a pool's lineage receipt. With `override.members` supplied, verify AS IF the pool held
   * those members — a mismatch with the MAC'd membership fails (this is the tamper canary).
   */
  verify(ref, override = {}) {
    const p = this._pools.get(ref);
    if (!p) return false;
    const members = override.members ? canonicalMembers(override.members) : p.members;
    const expect = this._mac({ ref, klass: p.klass, members, evaluation_hash: p.evaluation_hash, parent_ref: p.parent_ref, transition_kind: p.transition_kind });
    return expect === p.mac;
  }
}

export default { PoolRegistry };
