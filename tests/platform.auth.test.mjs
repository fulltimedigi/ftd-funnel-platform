/**
 * tests/platform.auth.test.mjs — pure auth + dashboard view logic (MVP accounts).
 * The browser client (fetch/localStorage) is a thin shell over these; this proves
 * the parts that must be correct regardless of the network: email validation,
 * GoTrue token normalization, expiry math, header construction, and the
 * dashboard's row→display mapping.
 */

import assert from "node:assert/strict";
import {
  isValidEmail, parseSession, isExpired, isSessionShape, authHeaders, restHeaders, SESSION_KEY,
} from "../platform/auth/authModel.js";
import { statusLabelAr, hostOf, titleOf, toDisplayItem, toDisplayList } from "../platform/dashboard/dashboardModel.js";

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

console.log("\nauth — email validation:");
check("accepts normal emails, rejects junk", () => {
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("  User@Example.COM "), true);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail("no-at"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail("a @b.co"), false);
});

console.log("\nauth — session parsing + expiry:");
check("parseSession computes expires_at from expires_in when absent", () => {
  const s = parseSession({ access_token: "a", refresh_token: "r", expires_in: 3600, user: { id: "u1", email: "e@x.co" } }, 1000);
  assert.equal(s.expires_at, 1000 + 3600);
  assert.equal(s.access_token, "a");
  assert.deepEqual(s.user, { id: "u1", email: "e@x.co" });
});
check("parseSession honours an explicit expires_at and returns null on missing tokens", () => {
  assert.equal(parseSession({ access_token: "a", refresh_token: "r", expires_at: 5000 }, 0).expires_at, 5000);
  assert.equal(parseSession({ access_token: "a" }, 0), null);
  assert.equal(parseSession(null, 0), null);
});
check("isExpired respects skew and malformed sessions", () => {
  const s = { access_token: "a", refresh_token: "r", expires_at: 1000 };
  assert.equal(isExpired(s, 900), false);           // 100s left, > 60s skew
  assert.equal(isExpired(s, 950), true);            // within 60s skew
  assert.equal(isExpired(s, 2000), true);           // long past
  assert.equal(isExpired(null, 0), true);
  assert.equal(isExpired({}, 0), true);
});
check("isSessionShape + stable storage key", () => {
  assert.equal(isSessionShape({ access_token: "a", refresh_token: "r", expires_at: 1 }), true);
  assert.equal(isSessionShape({ access_token: "a" }), false);
  assert.equal(SESSION_KEY, "ftd:auth-session");
});

console.log("\nauth — header construction:");
check("authHeaders uses the anon key pre-login and the bearer once signed in", () => {
  const pre = authHeaders("ANON", null);
  assert.equal(pre.apikey, "ANON");
  assert.equal(pre.Authorization, "Bearer ANON");
  const post = authHeaders("ANON", { access_token: "AT", refresh_token: "r", expires_at: 1 });
  assert.equal(post.Authorization, "Bearer AT");
});
check("restHeaders REQUIRES a session (never silently anonymous)", () => {
  assert.throws(() => restHeaders("ANON", null));
  const h = restHeaders("ANON", { access_token: "AT", refresh_token: "r", expires_at: 1 }, { Prefer: "return=representation" });
  assert.equal(h.apikey, "ANON");
  assert.equal(h.Authorization, "Bearer AT");
  assert.equal(h.Prefer, "return=representation");
});

console.log("\ndashboard — view mapping:");
check("statusLabelAr + hostOf + titleOf", () => {
  assert.equal(statusLabelAr("published"), "منشور");
  assert.equal(statusLabelAr("draft"), "مسودّة");
  assert.equal(hostOf("brand.com/x"), "brand.com");
  assert.equal(hostOf("https://Shop.Example.com/a"), "shop.example.com");
  assert.equal(titleOf({ name: "متجري" }), "متجري");
  assert.equal(titleOf({ name: "", store_url: "brand.com" }), "brand.com");
  assert.equal(titleOf({ id: "abc" }), "abc");
});
check("toDisplayItem shape", () => {
  const it = toDisplayItem({ id: "1", name: "N", store_url: "https://s.com", status: "draft", updated_at: "2026-01-02" });
  assert.equal(it.id, "1"); assert.equal(it.title, "N"); assert.equal(it.host, "s.com");
  assert.equal(it.statusLabel, "مسودّة"); assert.equal(it.updatedAt, "2026-01-02");
});
check("toDisplayList sorts newest-updated first", () => {
  const list = toDisplayList([
    { id: "a", store_url: "a.com", status: "draft", updated_at: "2026-01-01" },
    { id: "b", store_url: "b.com", status: "draft", updated_at: "2026-03-01" },
    { id: "c", store_url: "c.com", status: "draft", updated_at: "2026-02-01" },
  ]);
  assert.deepEqual(list.map((x) => x.id), ["b", "c", "a"]);
});

console.log(`\nplatform.auth — ${passed} checks passed.\n`);
