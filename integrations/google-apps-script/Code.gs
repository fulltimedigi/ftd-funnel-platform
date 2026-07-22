/**
 * integrations/google-apps-script/Code.gs — Funnel backend v2 (per-funnel isolation).
 * ===========================================================================
 * Receives POSTs from the funnel engine and routes by `type`:
 *   "lead"  → "<funnelId> Leads"  — upsert by lowercased email (latest wins)
 *   "event" → "<funnelId> Events" — append-only analytics (sheets-sink)
 *   "error" → "<funnelId> Errors" — append-only reports (error-monitor)
 *
 * PER-FUNNEL ISOLATION (ADR-0012): every funnelId gets its OWN tab trio, so
 * leads/events/errors from different funnels never mix, email lookup is scoped
 * to one funnel, and onboarding a new client = same /exec endpoint, new tabs
 * auto-created. funnelId is sanitized (alnum/-/_) before it names a tab.
 *
 * Field mapping matches THIS engine's real payloads (engine/index.js
 * buildLeadPayload, analytics/sheets-sink.js, engine/error-monitor.js) — NOT the
 * production engine's shapes. In particular: `source` is a plain string; error
 * entries use timestamp/level/message/url/userAgent/context.
 *
 * O(1) email upsert: an email→row map per Leads tab is cached in CacheService
 * (6h), rebuilt on miss and invalidated on every write; falls back to a linear
 * scan if cold. Deploy: Apps Script → Deploy → Web App, execute as me, access
 * Anyone; paste the /exec URL into config.analytics.sheetsEndpoint. See SETUP.md.
 */

// ─── Config ──────────────────────────────────────────────────────────────────

/** '' → the script's bound spreadsheet; set to a Spreadsheet ID for standalone. */
var SPREADSHEET_ID = '';

/** CacheService TTL for the email→row index (max 21600s / 6h). */
var EMAIL_CACHE_TTL_SECONDS = 21600;

/** Reported by the health check. */
var BACKEND_VERSION = '2.0.0';

/** 0-based index of the Email column in _leadHeaders(). MUST stay in sync. */
var EMAIL_COL_INDEX = 3;

// ─── Entry points ─────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _json({ ok: false, error: 'Empty request body' });
    }
    var payload = JSON.parse(e.postData.contents);
    var type = (payload.type || 'lead').toLowerCase();

    if (type === 'lead')  return _json(handleLead(payload));
    if (type === 'event') return _json(handleEvent(payload));
    if (type === 'error') return _json(handleError(payload));
    return _json({ ok: false, error: 'Unknown type: ' + type });
  } catch (err) {
    _log('[doPost] ' + (err && err.message));
    return _json({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() {
  return _json({ ok: true, service: 'FullTimeDigi Funnel Backend', version: BACKEND_VERSION, timestamp: new Date().toISOString() });
}

// ─── Lead handler ─────────────────────────────────────────────────────────────

function handleLead(payload) {
  var fid = _requireFunnelId(payload);
  if (fid.error) return fid;

  var email = String(payload.email || '').toLowerCase().trim();
  if (!email) return { ok: false, error: 'Missing email in lead payload' };

  var sheetName = fid + ' Leads';
  var sheet = _getOrCreateSheet(sheetName, _leadHeaders());
  var row = _extractLeadRow(payload);
  var existing = _findRowByEmailIndexed(sheet, sheetName, email);

  if (existing > 0) {
    _writeRow(sheet, existing, row);
    _invalidateEmailCache(sheetName);
    return { ok: true, action: 'updated', email: email };
  }
  sheet.appendRow(row);
  _invalidateEmailCache(sheetName);
  return { ok: true, action: 'created', email: email };
}

/** Leads header order — _extractLeadRow MUST match; Email is at EMAIL_COL_INDEX. */
function _leadHeaders() {
  return [
    'Timestamp', 'Funnel ID', 'Name', 'Email', 'Phone',
    'Primary Archetype', 'Primary Name', 'Secondary Archetype',
    'Flags', 'Scores (JSON)', 'Answers (JSON)', 'Result Layout',
    'Recommended', 'Decision Rule', 'Source',
  ];
}

function _extractLeadRow(p) {
  return [
    p.timestamp || new Date().toISOString(),
    p.funnelId || '',
    p.name || '',
    String(p.email || '').toLowerCase().trim(),
    p.phone || '',
    p.primaryArchetype || '',
    p.primaryArchetypeName || '',
    p.secondaryArchetype || '',
    Array.isArray(p.flags) ? p.flags.join(', ') : (p.flags || ''),
    JSON.stringify(p.scores || {}),
    JSON.stringify(p.answers || {}),
    p.resultLayout || '',
    p.recommended || '',
    p.decisionRule || '',
    typeof p.source === 'string' ? p.source : ((p.source && p.source.url) || ''),
  ];
}

// ─── Event handler ────────────────────────────────────────────────────────────

function handleEvent(payload) {
  var fid = _requireFunnelId(payload);
  if (fid.error) return fid;

  var sheet = _getOrCreateSheet(fid + ' Events', ['Timestamp', 'Funnel ID', 'Event', 'Payload (JSON)']);
  var payloadStr = typeof payload.payload === 'string' ? payload.payload : JSON.stringify(payload.payload || {});
  sheet.appendRow([payload.timestamp || new Date().toISOString(), fid, payload.event || '', payloadStr]);
  return { ok: true };
}

// ─── Error handler ────────────────────────────────────────────────────────────

function handleError(payload) {
  var fid = _requireFunnelId(payload);
  if (fid.error) return fid;

  var sheet = _getOrCreateSheet(fid + ' Errors', ['Timestamp', 'Funnel ID', 'Level', 'Message', 'URL', 'User Agent', 'Context (JSON)']);
  // error-monitor sends a single entry; tolerate an {errors:[…]} batch too.
  var entries = Array.isArray(payload.errors) ? payload.errors : [payload];
  entries.forEach(function (er) {
    sheet.appendRow([
      er.timestamp || new Date().toISOString(),
      fid,
      er.level || 'error',
      er.message || '',
      er.url || '',
      er.userAgent || '',
      typeof er.context === 'string' ? er.context : JSON.stringify(er.context || {}),
    ]);
  });
  return { ok: true, stored: entries.length };
}

// ─── Indexed email lookup ─────────────────────────────────────────────────────

function _findRowByEmailIndexed(sheet, sheetName, email) {
  var cache = CacheService.getScriptCache();
  var key = 'email_index_' + sheetName.replace(/\s/g, '_');
  var cached = cache.get(key);
  if (cached) {
    try {
      var idx = JSON.parse(cached);
      return idx[email] ? idx[email] : 0;
    } catch (e) { /* rebuild below */ }
  }
  return _buildEmailIndex(sheet, key, email, cache);
}

function _buildEmailIndex(sheet, cacheKey, targetEmail, cache) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  var col = sheet.getRange(2, EMAIL_COL_INDEX + 1, lastRow - 1, 1).getValues();
  var index = {}, result = 0;
  for (var i = 0; i < col.length; i++) {
    var cell = String(col[i][0] || '').toLowerCase().trim();
    var rowNum = i + 2;
    if (cell) index[cell] = rowNum;
    if (cell === targetEmail) result = rowNum;
  }
  try {
    var s = JSON.stringify(index);
    if (s.length < 95000) cache.put(cacheKey, s, EMAIL_CACHE_TTL_SECONDS);
  } catch (e) { /* caching is best-effort */ }
  return result;
}

function _invalidateEmailCache(sheetName) {
  CacheService.getScriptCache().remove('email_index_' + sheetName.replace(/\s/g, '_'));
}

// ─── Sheet helpers ────────────────────────────────────────────────────────────

function _getSpreadsheet() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function _getOrCreateSheet(name, headers) {
  var ss = _getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setBackground('#1e2d6b').setFontColor('#f7f4ec').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function _writeRow(sheet, rowNum, data) {
  sheet.getRange(rowNum, 1, 1, data.length).setValues([data]);
}

// ─── Validation + response ─────────────────────────────────────────────────────

function _requireFunnelId(payload) {
  var fid = String((payload && payload.funnelId) || '').trim();
  if (!fid) return { ok: false, error: 'Missing funnelId in payload' };
  if (!/^[a-zA-Z0-9_-]+$/.test(fid)) return { ok: false, error: 'Invalid funnelId (alnum, -, _ only): ' + fid };
  return fid;
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function _log(msg) {
  try { Logger.log(msg); } catch (e) { /* Logger absent outside GAS */ }
}

// ─── Manual test functions (run from the Apps Script editor) ──────────────────

function testLead() {
  _log(JSON.stringify(handleLead({
    type: 'lead', funnelId: 'freelancex', name: 'سيف', email: 'saif@example.com', phone: '+96550000000',
    primaryArchetype: 'development', primaryArchetypeName: 'مطوّر', secondaryArchetype: 'design',
    flags: ['EN_GOOD'], scores: { development: 12 }, answers: { q1: 'c' }, resultLayout: 'tracks',
    timestamp: new Date().toISOString(), source: 'FreelanceX',
  })));
}

function testEvent() {
  _log(JSON.stringify(handleEvent({
    type: 'event', funnelId: 'freelancex', event: 'quiz_start', timestamp: new Date().toISOString(),
    payload: JSON.stringify({ theme: 'platform-clean' }),
  })));
}

function testError() {
  _log(JSON.stringify(handleError({
    type: 'error', funnelId: 'freelancex', level: 'error', message: 'lead send failed',
    timestamp: new Date().toISOString(), url: 'https://x/', userAgent: 'UA', context: { attempt: 3 },
  })));
}
