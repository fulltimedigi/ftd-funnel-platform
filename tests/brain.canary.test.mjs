/**
 * tests/brain.canary.test.mjs — POISON CANARY for the structural checker (operator step 1). Feeds
 * deliberately-BROKEN trees to structuralViolations and asserts each break is caught. This is what proves
 * the checker actually checks — a checker run only on clean oudfactory passed vacuously (a 0-option
 * "degenerate" question slipped through `.every([])===true`, and a no-price product's missing leaf was
 * never exercised). Synthetic poison stays valid regardless of how the engine evolves.
 */
import assert from "node:assert";
import { structuralViolations } from "./lib/structuralChecks.js";

const leaf = (path, families) => ({ kind: "leaf", path, count: families.length, items: families.map((f) => ({ family: f })), skus: families.map((f) => f + "::0") });
const fam = (id, type) => ({ family_id: id, structured: { product_type: type }, prices: [10] });
const sku = (id) => ({ sku_id: id + "::0", family_id: id, price: 10, availability: "available", buy_url: "u" });
const axes = [{ axis_key: "type", values: [{ value: "T", families: ["a"] }] }];

// CLEAN baseline — a valid single-option tree, zero violations
const cleanTree = { kind: "question", axis: "type", options: [{ value: "T", child: leaf({ type: "T" }, ["a"]) }] };
assert.strictEqual(structuralViolations({ tree: cleanTree, familyMatrix: [fam("a", "T")], skuMatrix: [sku("a")], axes }).length, 0, "clean tree → zero violations");
const kinds = (t, fm, sm) => structuralViolations({ tree: t, familyMatrix: fm, skuMatrix: sm, axes }).map((x) => x.check);

// (0) DEGENERATE question — a question with 0 options (the vacuous gap that `.every([])` missed)
assert.ok(kinds({ kind: "question", axis: "type", options: [] }, [fam("a", "T")], [sku("a")]).includes("degenerate_question"), "catches a 0-option degenerate question");

// (1) EXACT-SUPPORT — an option whose subtree holds no product
assert.ok(kinds({ kind: "question", axis: "type", options: [{ value: "T", child: leaf({ type: "T" }, []) }] }, [fam("a", "T")], [sku("a")]).includes("empty_leaf"), "catches an empty leaf");

// (4) SKU IN LEAF — a purchasable SKU that reaches no leaf (the no-price silent drop)
assert.ok(kinds(cleanTree, [fam("a", "T"), fam("b", "T")], [sku("a"), sku("b")]).includes("sku_in_leaf"), "catches a SKU reaching no leaf");

// (3) PATH SATISFACTION — a product in a leaf that violates its path's type
assert.ok(kinds({ kind: "question", axis: "type", options: [{ value: "T", child: leaf({ type: "T" }, ["z"]) }] }, [fam("z", "OTHER")], [sku("z")]).includes("path_satisfaction"), "catches a product violating its path");

console.log("PASS — poison canary: structural checker catches degenerate_question, empty_leaf, sku_in_leaf, path_satisfaction on planted breaks (not vacuous).");
