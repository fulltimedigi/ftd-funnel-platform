/**
 * authoring/author/formatAxis.js — the HARD "format" axis (ADR-0034).
 * ---------------------------------------------------------------------------
 * A product's FORM (spray perfume / oil-attar / raw wood-bakhoor / set) is a FACT of
 * the catalog, not a soft preference the AI may re-weight. If a shopper picks "spray",
 * they must only ever see sprays. So format is derived DETERMINISTICALLY from the real
 * store data (title + attributes.type + tags) and marked `hard:true`; the covering
 * assignment then filters on it absolutely (see _assignCovering in index.js).
 *
 * Pure/Node-safe. `productFormat` returns "perfume" | "oil" | "raw" | "set" | null
 * (null = ambiguous → eligible for ANY format so it is never orphaned).
 */

const FORMAT_META = {
  perfume: { value: "perfume", label: "عطر بخّاخ" },
  oil: { value: "oil", label: "زيت / دهن عود" },
  raw: { value: "raw", label: "عود خام / بخور" },
  set: { value: "set", label: "مجموعة / طقم" },
};
const FORMAT_ORDER = ["perfume", "oil", "raw", "set"];

/** Deterministic form of a product from its real text. Priority matters: oil & perfume
 *  win over the generic "set/box" (an "Oud Oil Set" is oil; a "Wood Box" is raw). */
export function productFormat(p) {
  const parts = [p && p.name, p && p.attributes && p.attributes.type, p && p.attributes && p.attributes.category];
  if (p && Array.isArray(p.tags)) parts.push(p.tags.join(" "));
  const hay = parts.filter(Boolean).join(" ").toLowerCase();
  if (!hay.trim()) return null;
  // 1) OIL — attar / dehn / oud oil / oil (beats "set/box": "Oud Oil Set" = oil)
  if (/oud\s*oil|\battar\b|deh?n\b|زيت|دهن|\boil\b/.test(hay)) return "oil";
  // 2) PERFUME / SPRAY
  if (/parfum|extrait|eau\s*de|\bedp\b|\bedt\b|cologne|\bspray\b|perfume|بخّ?اخ|بارفان|كولون/.test(hay)) return "perfume";
  // 3) RAW wood / bakhoor (beats generic "set/box": "Wood Box" = raw)
  if (/agarwood|oud\s*wood|wood\s*chip|wood\s*box|\btola\b|bakh?oor|bukhoor|incense|عود\s*خام|قطع\s*عود|بخور|معمول/.test(hay)) return "raw";
  // 4) SET / bundle (generic — only if nothing above matched)
  if (/gift\s*set|bundle|collection|\bkit\b|\bset\b|باقة|مجموعة|طقم/.test(hay)) return "set";
  return null;
}

/**
 * Build the HARD format axis for a catalog: url→format profile + a value per format that
 * is actually present. Returns null when fewer than 2 formats exist (no format question
 * is needed — everything is the same form).
 */
export function deriveFormatAxis(products) {
  const profile = new Map();
  const present = new Set();
  for (const p of products || []) {
    const f = productFormat(p);
    if (f) { profile.set(p.url, f); present.add(f); }
  }
  const values = FORMAT_ORDER.filter((f) => present.has(f)).map((f) => FORMAT_META[f]);
  if (values.length < 2) return null;
  return { id: "format", label: "الشكل", question: "كيف تحبّ تستخدم عطرك؟", values, profile, hard: true };
}

// STRONG form phrases only — never bare "wood"/"oud"/"oil"/"set" (those appear inside
// scent words like "woody" and would wrongly flag a character axis). ADR-0034.
const FMT_WORDS = /عطر بخّ?اخ|بخّ?اخ|دهن عود|زيت عطر|عود خام|قطع عود|بخور|مجموعة|طقم هدايا|باقة|parfum|perfume|\bspray\b|oud\s*oil|\battar\b|agarwood|wood\s*chip|wood\s*box|gift\s*set|bundle|cologne|extrait|eau\s*de/i;

/** Does an AI/mined axis duplicate the format axis (so we drop it to avoid two form
 *  questions)? True if its label reads like form/type, or most of its values are forms. */
export function looksLikeFormatAxis(axis) {
  if (!axis || !Array.isArray(axis.values)) return false;
  if (/شكل|نوع المنتج|\bformat\b|product\s*type|\bform\b/i.test(String(axis.label || axis.id || ""))) return true;
  const hits = axis.values.filter((v) => FMT_WORDS.test(String((v && (v.label || v.value)) || ""))).length;
  return hits >= Math.ceil(axis.values.length / 2);
}
