/**
 * analytics/sheets-sink.js — Google Sheets transport (SPEC §10, §12).
 *
 * Phase: lead loop only. Posts a lead payload to the Apps Script /exec endpoint
 * so it lands in the Google Sheet. (Analytics-event forwarding comes later.)
 *
 * CORS reality (documented, per SPEC §10): Apps Script web apps don't return
 * CORS headers, so the browser can't read the response. We POST as a "simple
 * request" (text/plain → no preflight) in `no-cors` mode: a resolved fetch means
 * the request was SENT (row written), a thrown fetch means a real network
 * failure. We therefore report { ok:true, confirmed:false } on send — we cannot
 * read the server's confirmation, so we never claim more than "sent".
 *
 * Safety net: every submitted lead is also appended to a localStorage audit
 * queue, so a lead is never lost even when confirmation is impossible.
 *
 * createSheetsSink(endpoint) → { endpoint, submit(payload) -> Promise<result> }
 *   result: { ok:boolean, confirmed?:boolean, reason?:string, error?:string }
 */

function isUsableEndpoint(endpoint) {
  return typeof endpoint === "string" && endpoint.length > 0 && !endpoint.startsWith("PASTE_");
}

export function createSheetsSink(endpoint) {
  return {
    endpoint,
    async submit(payload) {
      if (!isUsableEndpoint(endpoint)) {
        return { ok: false, reason: "no-endpoint" };
      }

      // Audit trail first — don't lose the lead even if the network fails.
      try {
        const key = "ftd:leads:" + (payload.funnelId || "default");
        const prev = JSON.parse(globalThis.localStorage?.getItem(key) || "[]");
        prev.push(payload);
        globalThis.localStorage?.setItem(key, JSON.stringify(prev));
      } catch {
        /* localStorage unavailable — non-fatal */
      }

      try {
        await fetch(endpoint, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload),
        });
        // Opaque response under no-cors: request was sent, can't read result.
        return { ok: true, confirmed: false };
      } catch (err) {
        return { ok: false, reason: "network", error: String(err) };
      }
    },
  };
}
