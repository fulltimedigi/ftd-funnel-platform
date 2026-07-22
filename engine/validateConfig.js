/**
 * engine/validateConfig.js — Executable config validation (ADR-0009).
 * ---------------------------------------------------------------------------
 * Makes configs/_schema.json the SINGLE, EXECUTABLE source of truth. Both source
 * engines left the schema decorative (never run); this validates a config object
 * against the schema at boot so contract violations surface early and honestly.
 *
 * A tiny, dependency-free JSON-Schema (draft-07 subset) checker — enough for our
 * schema: type, enum, const, required, properties, items, $ref (#/definitions/…),
 * minItems/maxItems, minLength, minimum/maximum. Extra/unknown properties are
 * allowed (the schema sets no additionalProperties:false), and annotation
 * keywords (description, default, title…) are ignored. Pure + Node-safe; never
 * throws — a malformed schema yields errors, not a crash.
 */

function jsType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v; // "object" | "string" | "number" | "boolean" | "undefined"
}

function typeMatches(v, t) {
  if (t === "object") return jsType(v) === "object";
  if (t === "array") return jsType(v) === "array";
  if (t === "integer") return typeof v === "number" && Number.isInteger(v);
  if (t === "number") return typeof v === "number";
  return typeof v === t; // "string" | "boolean"
}

function resolveRef(ref, root) {
  // Only local refs of the form "#/a/b/c" are supported.
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  let node = root;
  for (const seg of ref.slice(2).split("/")) {
    if (node && typeof node === "object" && seg in node) node = node[seg];
    else return null;
  }
  return node;
}

function joinPath(path, key) {
  return path ? `${path}.${key}` : String(key);
}

function _validate(value, schema, root, path, errors) {
  if (!schema || typeof schema !== "object") return;

  if (schema.$ref) {
    const target = resolveRef(schema.$ref, root);
    if (target) _validate(value, target, root, path, errors);
    return;
  }

  // Type: on mismatch, report and stop descending (avoids noise).
  if (schema.type && !typeMatches(value, schema.type)) {
    errors.push({ path: path || "(root)", message: `expected ${schema.type}, got ${jsType(value)}` });
    return;
  }

  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push({ path: path || "(root)", message: `must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}` });
  }

  if ("const" in schema && value !== schema.const) {
    errors.push({ path: path || "(root)", message: `must equal ${JSON.stringify(schema.const)}` });
  }

  if (jsType(value) === "object") {
    for (const req of schema.required || []) {
      if (!(req in value) || value[req] === undefined) {
        errors.push({ path: joinPath(path, req), message: "is required" });
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in value && value[k] !== undefined) _validate(value[k], sub, root, joinPath(path, k), errors);
      }
    }
  }

  if (jsType(value) === "array") {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push({ path: path || "(root)", message: `must have at least ${schema.minItems} item(s), has ${value.length}` });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push({ path: path || "(root)", message: `must have at most ${schema.maxItems} item(s), has ${value.length}` });
    }
    if (schema.items) {
      value.forEach((item, i) => _validate(item, schema.items, root, `${path || "(root)"}[${i}]`, errors));
    }
  }

  if (typeof value === "string" && typeof schema.minLength === "number" && value.length < schema.minLength) {
    errors.push({ path: path || "(root)", message: `must be at least ${schema.minLength} character(s)` });
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push({ path: path || "(root)", message: `must be ≥ ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push({ path: path || "(root)", message: `must be ≤ ${schema.maximum}` });
    }
  }
}

/**
 * Validate a config object against a JSON schema.
 * @param {Object} config
 * @param {Object} schema - the parsed configs/_schema.json
 * @returns {{ valid: boolean, errors: Array<{path:string, message:string}> }}
 */
export function validateConfig(config, schema) {
  const errors = [];
  try {
    _validate(config, schema, schema, "", errors);
  } catch (err) {
    errors.push({ path: "(validator)", message: `validation aborted: ${err?.message || String(err)}` });
  }
  return { valid: errors.length === 0, errors };
}

/** Human-readable one-error-per-line rendering of a validation result. */
export function formatValidationErrors(result) {
  if (!result || result.valid) return "config is valid.";
  return result.errors.map((e) => `  • ${e.path}: ${e.message}`).join("\n");
}
