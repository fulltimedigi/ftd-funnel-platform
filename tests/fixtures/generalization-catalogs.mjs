/**
 * tests/fixtures/generalization-catalogs.mjs — 5 synthetic Shopify catalogs from NON-perfume domains,
 * built BEFORE running (red-first) with a DECLARED structural expectation each. Purpose: test the founding
 * hypothesis ("one root cause across domains") on the NEW brain — is it general, or oud-shaped?
 * RULE: no gold (gold is oudfactory-specific); checks are self-sufficient structural walks.
 * GUARD: these catalogs must NOT be edited after seeing results to make them pass (recorded rule).
 */

const P = (handle, title, product_type, tags, variants, body = "") => ({
  handle, title, body_html: body, vendor: "Acme", product_type, tags,
  options: [{ name: "Variant" }],
  variants: variants.map((v, i) => ({ id: `${handle}-${i}`, title: v.t, price: String(v.p), available: v.a !== false, option1: v.t })),
});

// C1 — ELECTRONICS (rich structured): distinct product_type categories + a REAL hard constraint (OS) that
// lives in tags. DECLARED: engine SHOULD use structured fields (type ✓) and be able to gate on a hard
// attribute (OS/compatibility). PREDICTION: it discovers type+price only; OS (a tag/attribute) is NOT
// mined -> a buyer who needs macOS cannot express it. Reveals: no generic structured-attribute axis.
export const electronics = {
  domain: "electronics",
  expectation: "type(Laptop/Desktop/Monitor)+price discovered; a HARD OS/compatibility axis SHOULD exist. PREDICT: only type+price; OS not mined (no attribute miner).",
  products: [
    P("mbp-14", "MacBook Pro 14", "Laptop", ["macOS", "16GB"], [{ t: "16GB", p: 1999 }, { t: "32GB", p: 2499 }]),
    P("mba-13", "MacBook Air 13", "Laptop", ["macOS", "8GB"], [{ t: "8GB", p: 1099 }, { t: "16GB", p: 1299 }]),
    P("xps-15", "Dell XPS 15", "Laptop", ["Windows", "16GB"], [{ t: "16GB", p: 1499 }, { t: "32GB", p: 1899 }]),
    P("tp-x1", "ThinkPad X1", "Laptop", ["Windows", "16GB"], [{ t: "16GB", p: 1699 }]),
    P("mac-mini", "Mac Mini", "Desktop", ["macOS"], [{ t: "M2", p: 599 }, { t: "M2 Pro", p: 1299 }]),
    P("opti-7000", "OptiPlex 7000", "Desktop", ["Windows"], [{ t: "i5", p: 899 }]),
    P("u2723", "UltraSharp 27", "Monitor", ["4K"], [{ t: "27in", p: 649 }]),
  ],
};

// C2 — COFFEE (ordinal axis roast: light<medium<dark). DECLARED: roast SHOULD be an ORDINAL decision axis.
// PREDICT: only price is ordinal-discovered; roast (in tags) is not mined -> ordinal handling untested.
export const coffee = {
  domain: "coffee",
  expectation: "an ORDINAL roast axis (light<medium<dark) SHOULD be discovered/handled. PREDICT: only price is ordinal; roast not mined.",
  products: [
    P("ethiopia", "Ethiopia Yirgacheffe", "Coffee", ["light-roast", "single-origin"], [{ t: "250g", p: 18 }, { t: "1kg", p: 60 }]),
    P("kenya-aa", "Kenya AA", "Coffee", ["light-roast"], [{ t: "250g", p: 20 }]),
    P("colombia", "Colombia Supremo", "Coffee", ["medium-roast"], [{ t: "250g", p: 15 }, { t: "1kg", p: 50 }]),
    P("brazil", "Brazil Santos", "Coffee", ["medium-roast"], [{ t: "250g", p: 13 }]),
    P("italian", "Italian Roast", "Coffee", ["dark-roast"], [{ t: "250g", p: 14 }]),
    P("french", "French Roast", "Coffee", ["dark-roast"], [{ t: "250g", p: 14 }, { t: "1kg", p: 46 }]),
  ],
};

// C3 — ADVERSARIAL chaotic: bad text, missing product_type, conflicting evidence (product_type contradicts
// title), missing/zero prices. DECLARED (ق23 + UNKNOWN policy): accounting holds (unaccounted=0); no fabricated
// axis from garbage; conflicting/absent signals default to UNKNOWN, never invented. PREDICT: accounting robust;
// type only where product_type present; garbage does not become a published axis value.
export const adversarial = {
  domain: "adversarial",
  expectation: "unaccounted=0; garbage/conflicts -> UNKNOWN not fabricated; no junk axis published. PREDICT: accounting robust; no garbage axis.",
  products: [
    P("x1", "!!!  ", "", [], [{ t: "Default Title", p: 10 }]),                         // empty type, junk title
    P("x2", "Laptop Deluxe", "Perfume", ["???"], [{ t: "A", p: 50 }]),                  // type contradicts title
    P("x3", "Mystery Item", "Widget", [], [{ t: "A", p: null }, { t: "B", p: 0 }]),     // missing/zero price
    P("x4", "Wooden Oud Indian Cambodi Borneo", "Widget", [], [{ t: "A", p: 30 }]),     // origin-token soup in title
    P("x5", "  ", "Widget", [], [{ t: "A", p: 40 }, { t: "B", p: 45 }]),
  ],
};

// C4 — TINY catalog (≤4 profiles). DECLARED (ق20 / d*): must yield a GRID / single-selector, NOT a multi-step
// quiz. PREDICT: the tree builds a quiz regardless of size -> mirror mode NOT implemented -> FAIL (show, don't fix).
export const tiny = {
  domain: "tiny",
  expectation: "≤4 profiles ⇒ GRID/single-selector, NOT a quiz (ق20, d*). PREDICT: tree still builds a quiz -> mode missing.",
  products: [
    P("a", "Alpha", "Gadget", [], [{ t: "A", p: 20 }]),
    P("b", "Beta", "Gadget", [], [{ t: "A", p: 25 }]),
    P("c", "Gamma", "Gadget", [], [{ t: "A", p: 30 }]),
  ],
};

// C5 — NO valid axis: one type, one price band, no origin, no facet. DECLARED (ق16): recommendation-light,
// NOT a fake quiz. PREDICT: no axis published -> the tree degenerates (empty question) -> mode NOT implemented -> FAIL.
export const noAxis = {
  domain: "no-axis",
  expectation: "no valid axis ⇒ recommendation-light, NOT a fake quiz (ق16). PREDICT: degenerate/empty tree -> mode missing.",
  products: [
    P("i1", "Item One", "Item", [], [{ t: "A", p: 100 }]),
    P("i2", "Item Two", "Item", [], [{ t: "A", p: 100 }]),
    P("i3", "Item Three", "Item", [], [{ t: "A", p: 100 }]),
    P("i4", "Item Four", "Item", [], [{ t: "A", p: 100 }]),
    P("i5", "Item Five", "Item", [], [{ t: "A", p: 100 }]),
  ],
};

export const ALL = [electronics, coffee, adversarial, tiny, noAxis];
