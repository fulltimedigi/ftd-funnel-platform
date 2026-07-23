/**
 * analytics/webhook-sink.js — Universal Webhook lead sink (ADR-0020).
 * ---------------------------------------------------------------------------
 * POSTs the full lead payload to a client-configured webhook URL — the 80/20 that
 * unlocks GHL, Zapier, Make, and most CRMs at once (integrate, never compete). Our
 * edge is the payload: email + the user's answers + the recommended REAL product +
 * archetype + score, so downstream tools can route and personalize.
 *
 * Honest delivery: a real webhook usually returns CORS + a status, so we read it
 * and CONFIRM ({ok:true, confirmed:true}); if CORS blocks the read we fall back to
 * a no-cors fire-and-forget ({ok:true, confirmed:false} = sent, unconfirmable); a
 * hard failure is {ok:false} — never a fake success (rule 4). Injected-`fetch`,
 * Node-safe.
 */

/** A usable webhook URL: http(s), non-empty, not a paste-placeholder. */
export function isUsableWebhook(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url) && !url.startsWith("PASTE_") && !/YOUR_WEBHOOK/i.test(url);
}

export function createWebhookSink(url) {
  return {
    endpoint: url,
    async submit(payload) {
      if (!isUsableWebhook(url)) return { ok: false, reason: "no-endpoint" };

      // Audit copy first — never lose a lead even if the network fails.
      try {
        const key = "ftd:webhook-leads:" + (payload.funnelId || "default");
        const prev = JSON.parse(globalThis.localStorage?.getItem(key) || "[]");
        prev.push(payload);
        globalThis.localStorage?.setItem(key, JSON.stringify(prev.slice(-50)));
      } catch { /* localStorage unavailable — non-fatal */ }

      if (typeof fetch !== "function") return { ok: false, reason: "no-fetch" };

      // 1) CORS POST — read the status and confirm honestly.
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res && (res.ok || res.status === 0)) return { ok: true, confirmed: res.status !== 0, status: res.status };
        return { ok: false, reason: "http-" + (res && res.status), status: res && res.status };
      } catch (err) {
        // 2) CORS blocked (or network) → fire-and-forget no-cors; sent but unconfirmable.
        try {
          await fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
          return { ok: true, confirmed: false };
        } catch (err2) {
          return { ok: false, reason: "network", error: String(err2 && err2.message || err2) };
        }
      }
    },
  };
}
