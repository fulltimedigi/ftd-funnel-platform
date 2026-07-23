/**
 * platform/tenantStore.js — Multi-tenant store with strict isolation (ADR-0022).
 * ---------------------------------------------------------------------------
 * The isolation SPINE of the SaaS. Every read/write is scoped by `tenantId`; a
 * caller can NEVER reach another tenant's projects or secrets. This in-memory
 * implementation is the contract 3C re-implements over Postgres row-level
 * security — so the no-leak guarantee is designed in and tested now, not later.
 *
 * Security posture (rule 3, ADR-0012 at platform scale):
 *   - A tenantId is required on every operation; a falsy one is rejected.
 *   - getProject/listProjects/putProject only ever touch rows whose tenantId
 *     matches — a wrong tenantId yields null/empty, never a foreign row.
 *   - Per-tenant SECRETS (sink URLs/keys) live in a separate per-tenant bucket,
 *     unreachable across tenants. Secrets are never returned by project reads.
 *
 * Pure/Node-safe: no globals, no I/O. An injectable `genId` keeps ids
 * deterministic in tests (no Date.now / Math.random inside).
 */

function _requireTenant(tenantId) {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new Error("tenantStore: a non-empty tenantId is required");
  }
  return tenantId;
}

/**
 * @param {{genId?: () => string}} [opts]
 */
export function createMemoryStore(opts = {}) {
  let _n = 0;
  const genId = typeof opts.genId === "function" ? opts.genId : () => "p" + (++_n);

  const tenants = new Map();          // tenantId -> { id }
  const projects = new Map();         // projectId -> project (each carries tenantId)
  const secretsByTenant = new Map();  // tenantId -> Map(key -> value)

  function _owns(tenantId, project) {
    return !!project && project.tenantId === tenantId;
  }

  return {
    /* ----------------------------------------------------------- tenants -- */
    createTenant(tenantId) {
      _requireTenant(tenantId);
      if (!tenants.has(tenantId)) tenants.set(tenantId, { id: tenantId });
      if (!secretsByTenant.has(tenantId)) secretsByTenant.set(tenantId, new Map());
      return tenants.get(tenantId);
    },
    hasTenant(tenantId) {
      return tenants.has(_requireTenant(tenantId));
    },

    /* ---------------------------------------------------------- projects -- */
    // Insert or update. On insert an id is assigned; on update the caller MUST
    // own the row (matching tenantId) or the write is refused — no cross-tenant
    // overwrite, and no silently reparenting a row to another tenant.
    putProject(tenantId, project) {
      _requireTenant(tenantId);
      if (!project || typeof project !== "object") throw new Error("tenantStore: project object required");
      if (project.id) {
        const existing = projects.get(project.id);
        if (existing && !_owns(tenantId, existing)) return null; // cross-tenant write refused
      }
      const id = project.id || genId();
      const row = { ...project, id, tenantId };                  // tenantId is authoritative, never client-set
      projects.set(id, row);
      return { ...row };
    },
    getProject(tenantId, projectId) {
      _requireTenant(tenantId);
      const row = projects.get(projectId);
      return _owns(tenantId, row) ? { ...row } : null;           // foreign / missing → null
    },
    listProjects(tenantId) {
      _requireTenant(tenantId);
      const out = [];
      for (const row of projects.values()) if (_owns(tenantId, row)) out.push({ ...row });
      return out;
    },
    deleteProject(tenantId, projectId) {
      _requireTenant(tenantId);
      const row = projects.get(projectId);
      if (!_owns(tenantId, row)) return false;                   // can't delete a foreign row
      return projects.delete(projectId);
    },

    /* ----------------------------------------------------------- secrets -- */
    // Per-tenant secret bucket (sink URLs / API keys). Never returned by a
    // project read; never reachable from another tenant.
    putSecret(tenantId, key, value) {
      _requireTenant(tenantId);
      if (!secretsByTenant.has(tenantId)) secretsByTenant.set(tenantId, new Map());
      secretsByTenant.get(tenantId).set(String(key), value);
      return true;
    },
    getSecret(tenantId, key) {
      _requireTenant(tenantId);
      const bucket = secretsByTenant.get(tenantId);
      return bucket && bucket.has(String(key)) ? bucket.get(String(key)) : null;
    },
  };
}
