# ADR-0040 — Fail-closed security hardening (secrets, SSRF, CSP, cost cap)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Scope:** the serverless generation path + ingestion fetch + preview surfaces. An INDEPENDENT
  security commit — it does not touch the render/kernel correctness core (certifyForRender /
  policyRegistry / kernel), which shipped in ADR-0038/0039. The generation network surface was not
  widened by that correctness work, so the security scope is unchanged.
- **Basis:** a confirmed code audit re-verified line-by-line against HEAD. Every fix below is closed
  by a **revert-catcher** integration test (`tests/security-hardening.test.mjs`) — a test that fails
  if the fix is undone. "Tests are green" alone was not accepted as done.

## The rule: fail CLOSED

The prior gates were `if (secret) { enforce }` — an unset secret silently DISABLED the check, so an
unconfigured internet-facing deploy was wide open. For **REAL secrets** (server↔server / id keying)
the gate is inverted: **a missing secret is a hard refusal in production; only genuine dev/local
(`CONTEXT==="dev"` or no Netlify context with `NODE_ENV!=="production"`) runs lenient, and only with a
loud one-time warning.** A public Deploy Preview is treated as production — it can burn the Opus budget
just like prod. (`platform/security/secrets.js`.)

**Fail-closed applies to REAL secrets ONLY — not to the public token (corrected 2026-07-24).**
`FTD_PUBLIC_TOKEN` gates the PUBLIC self-service endpoints (submit/status). A browser on a public tool
cannot carry a real secret, so it is **optional friction, not authentication** — making it fail-closed
would 401 every real visitor and break the public UI (the intake page only sends the header when a
`window.__FTD_TOKEN__` is present, which it is not on the public site, and `isProd()` counts the Deploy
Preview as prod). So the public token stays **enforce-only-when-configured**: enforced (constant-time)
when set, open when unset. Public-endpoint abuse is bounded instead by the daily cost cap (CAS), the
SSRF guard, unguessable HMAC job ids, and the fail-closed INTERNAL secret on the background function.
(Real public rate-limiting / captcha is a documented future item.)

## Fixes

1. **Real secrets → fail-closed; public token → NOT.** `FTD_INTERNAL_SECRET` (background Opus job):
   unset in prod → **503** before any work; set → header matched in **constant time**. `FTD_ID_SALT`:
   mandatory in prod (item 2). The public `FTD_PUBLIC_TOKEN` is **enforce-only-when-configured**
   (constant-time when set, open when unset) — deliberately NOT fail-closed, because it is optional
   friction on a public browser endpoint, not real auth (see the corrective note above).
2. **Job id → HMAC + mandatory salt.** `keyFor` was `sha256((FTD_ID_SALT||"") + "|" + url)` — it
   failed OPEN (empty salt → guessable id) and was weaker than a keyed MAC. Now
   **HMAC-SHA256(FTD_ID_SALT, normalized-url)**; the salt is **mandatory in production** (missing →
   throws, never the empty key); dev uses a loud fixed non-secret fallback so hashing is never keyed
   by `""`. Same salt+url → same key, so the design cache still works.
3. **SSRF — every IP encoding + real DNS-rebinding.** The classifier decoded only dotted-quad. Now
   `parseIPv4Any` decodes **decimal / hex / octal / short-form** (inet_aton) and IPv6 literals
   (incl. Node's normalized `::ffff:hhhh:hhhh` mapped form) BEFORE the range check, so
   `2130706433` / `0x7f000001` / `0177.0.0.1` / `127.1` / `[::1]` / `[::ffff:169.254.169.254]` are
   blocked. The **false comment** that claimed DNS rebinding was "closed with resolve-then-pin" (it
   was never implemented) is corrected; `fetcher.js` now **actually resolves the host and refuses the
   fetch if ANY A/AAAA record is private**, re-checking every redirect hop. (This is a resolve-time
   check, not full socket-pinning — stated honestly in the comment; it closes the practical vector of
   a hostile domain pointing DNS at an internal/metadata address.)
4. **CSP `/embed`.** The old one-line override replaced the WHOLE policy with `frame-ancestors *`,
   dropping `default-src`/`script-src`/`object-src`/`base-uri`/`form-action` on config-rendering
   pages. Now the **full hardened policy is kept**; only `frame-ancestors` is widened (embeddable
   funnels on arbitrary customer sites are the product — `docs/PRODUCT_DECISIONS.md` — so the wildcard
   is intentional and documented, not an oversight) and `X-Frame-Options` dropped for cross-origin framing.
5. **`?config=<url>` → same-origin only.** Both the Studio review page and the embed funnel accepted
   any absolute `https://…` config, letting an attacker render arbitrary content under our trusted
   origin. A shared, unit-tested `safeConfigPath` now accepts only a **same-origin relative** path
   (no scheme, no `//host`, no backslash); a cross-origin/scheme value is ignored and falls through to
   the allow-listed `?funnel=<id>`. (`platform/configSource.js`.)
6. **Daily cost cap → atomic CAS.** `underDailyCap` was get→compare→set — a TOCTOU race let concurrent
   submits each read the same count and overrun the ONLY guard before an Opus call. Now
   `reserveDailySlot` uses the store's **compare-and-swap** (`getWithMeta` + `setIfMatch`) with bounded
   retries, and **fails closed** (denies) if it can't win a slot under contention.
7. **Secret-bearing trigger target.** The internal trigger base was
   `DEPLOY_PRIME_URL || URL || "https://"+event.headers.host`. Host is attacker-controlled, and the
   request carries `FTD_INTERNAL_SECRET` → a spoofed Host would exfiltrate the secret. Now `triggerBase`
   reads **trusted env only**; no base → **503**, never a Host fallback. The check runs before storage
   so a misconfig fails fast.
8. **In-flight window ≥ background runtime.** `IN_FLIGHT_MS` was 4 min while background functions run
   up to 15 min → a still-running job was re-triggered into a concurrent double-generation. Raised to
   **16 min** (> 15).
9. **Constant-time secret comparison.** `safeEqual` hashes both inputs to fixed-length digests then
   `timingSafeEqual` — never a length-dependent `===`, never a throw/leak on unequal length.

## Verification

`npm test` = **607 assertions green**. `tests/security-hardening.test.mjs` (20 assertions) is all
revert-catchers, grouped by item: fail-closed 503/deny in prod vs lenient-in-dev; keyFor throws
without a salt and is HMAC-keyed; obfuscated-IP + rebinding blocks (and hermetic offline tests still
skip DNS); same-origin-only `?config`; CAS cap never over-spends; spoofed-Host trigger → 503; the
`/embed` CSP still carries the hardened directives.

## Operator action required (I cannot set these)

The fail-closed posture means a **production/preview deploy MUST have these two REAL secrets set in
Netlify**, or the server↔server / id-keying paths refuse (by design). Set, under *Site settings →
Environment variables*: `FTD_INTERNAL_SECRET` and `FTD_ID_SALT` (any long random strings).
`FTD_PUBLIC_TOKEN` is **optional** — leave it unset and the public UI works; set it only if you want
an extra shared-token gate on the public endpoints. Without the two real secrets the background job /
id keying refuse — that is the fix working, not a bug; the public submit/status pages still load.

## Consequences

- An unconfigured internet-facing deploy is now inert (refuses) instead of wide open — the correct
  direction to fail.
- The preview requires the two REAL secrets (`FTD_INTERNAL_SECRET`, `FTD_ID_SALT`); the public token
  is optional and its gate is enforce-only-when-configured so the public UI never breaks.
- Full socket-pinning for DNS rebinding remains a later hardening (the resolve-time check closes the
  practical vector); noted honestly in code, not overclaimed.
