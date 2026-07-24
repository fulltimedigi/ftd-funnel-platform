/**
 * platform/dashboard/dashboardModel.js — PURE view logic for "My Funnels".
 * ---------------------------------------------------------------------------
 * Shapes raw funnel rows (from PostgREST) into display items. No DOM, no clock,
 * no network — deterministic and Node-unit-testable. The dashboard page is a
 * thin renderer over these functions.
 */

/** Arabic label for a funnel status. */
export function statusLabelAr(status) {
  switch (status) {
    case "draft": return "مسودّة";
    case "generating": return "قيد التوليد";
    case "ready": return "جاهز";
    case "published": return "منشور";
    case "archived": return "مؤرشف";
    default: return status || "—";
  }
}

/** Best-effort host of a URL, without throwing on junk input. */
export function hostOf(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  try { return new URL(/^[a-z]+:\/\//i.test(s) ? s : "https://" + s).hostname; } catch { return s; }
}

/** A human title for a funnel row: explicit name → store host → id. */
export function titleOf(row) {
  if (!row) return "فانل";
  const name = (row.name && String(row.name).trim()) || "";
  if (name) return name;
  const host = hostOf(row.store_url);
  return host || row.id || "فانل";
}

/** Map a raw row to the item the UI renders. */
export function toDisplayItem(row) {
  return {
    id: row.id,
    title: titleOf(row),
    storeUrl: row.store_url || "",
    host: hostOf(row.store_url),
    status: row.status,
    statusLabel: statusLabelAr(row.status),
    updatedAt: row.updated_at || row.created_at || null,
  };
}

/** Rows → display items, newest-updated first (stable if timestamps are equal). */
export function toDisplayList(rows) {
  const arr = Array.isArray(rows) ? rows.slice() : [];
  arr.sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || "")));
  return arr.map(toDisplayItem);
}

export default { statusLabelAr, hostOf, titleOf, toDisplayItem, toDisplayList };
