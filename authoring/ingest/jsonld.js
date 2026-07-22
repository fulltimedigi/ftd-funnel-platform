/**
 * authoring/ingest/jsonld.js — Extract schema.org/Product from JSON-LD.
 * ---------------------------------------------------------------------------
 * Stage 1 (ADR-0013), best-first extraction #1. Reads
 * `<script type="application/ld+json">` blocks and pulls Product nodes into the
 * canonical product shape. Highest precision, lowest effort — Google's
 * recommended format, so most modern stores carry it.
 *
 * Dependency-free: scripts are located by regex and parsed with JSON.parse
 * (malformed blocks are skipped, never guessed). Pure, Node-safe.
 */

import { makeProduct, stripTags } from "./product.js";

const SCRIPT_RE = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** All parsed JSON-LD objects on a page (tolerant: bad blocks skipped). */
export function extractJsonLd(html) {
  const out = [];
  if (typeof html !== "string") return out;
  let m;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      out.push(parsed);
    } catch { /* malformed JSON-LD block — skip, don't guess */ }
  }
  return out;
}

/** Flatten JSON-LD roots into a flat list of nodes (handles arrays + @graph). */
function _flatten(nodes) {
  const flat = [];
  const visit = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    flat.push(n);
    if (Array.isArray(n["@graph"])) n["@graph"].forEach(visit);
  };
  nodes.forEach(visit);
  return flat;
}

function _typeIncludes(node, wanted) {
  const t = node["@type"];
  if (!t) return false;
  const arr = Array.isArray(t) ? t : [t];
  return arr.some((x) => String(x).toLowerCase() === wanted);
}

function _firstImage(image) {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return _firstImage(image[0]);
  if (typeof image === "object") return image.url || image.contentUrl || null;
  return null;
}

function _brandName(brand) {
  if (!brand) return null;
  if (typeof brand === "string") return brand;
  if (Array.isArray(brand)) return _brandName(brand[0]);
  if (typeof brand === "object") return brand.name || null;
  return null;
}

/** Pull price + currency + offer url from an offers value (Offer/AggregateOffer/array). */
function _offer(offers) {
  if (!offers) return {};
  if (Array.isArray(offers)) return _offer(offers[0]);
  if (typeof offers !== "object") return {};
  const price = offers.price ?? offers.lowPrice ?? offers.highPrice ?? null;
  return { price, currency: offers.priceCurrency || null, url: offers.url || null };
}

/**
 * Products found in a page's JSON-LD, as canonical records with provenance.
 * @param {string} html
 * @param {string} pageUrl - where the HTML came from (fallback product url + sourceUrl)
 */
export function productsFromJsonLd(html, pageUrl) {
  const nodes = _flatten(extractJsonLd(html));
  const products = [];
  for (const node of nodes) {
    if (!_typeIncludes(node, "product")) continue;
    const offer = _offer(node.offers);
    products.push(makeProduct({
      name: node.name,
      description: stripTags(node.description || ""),
      price: offer.price,
      currency: offer.currency,
      url: offer.url || node.url || pageUrl || "",
      image: _firstImage(node.image),
      sku: node.sku || node.mpn || null,
      brand: _brandName(node.brand),
      attributes: node.category ? { category: node.category } : {},
      sourceUrl: pageUrl || node.url || "",
      method: "json-ld",
      confidence: 0.9,
    }));
  }
  return products;
}
