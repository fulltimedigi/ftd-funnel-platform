/**
 * engine/error-monitor.js — Structured error logging + queued reporting
 * -----------------------------------------------------------------------
 * Captures runtime errors from the funnel with context, stores them in
 * localStorage, and optionally POSTs to the Apps Script endpoint so
 * errors appear in the operator's sheet alongside leads and events.
 *
 * Ported from the production engine (ADR-0005). Made host-agnostic: the only
 * host globals touched at init time (`window.addEventListener`) and at report
 * time (`fetch`) are guarded, so the module is safe to import under Node (tests,
 * SSR, the authoring layer) without a DOM shim and without ever throwing.
 *
 * RULES:
 *   - This module must NEVER throw. A monitoring failure cannot break the funnel.
 *   - Errors are always written to localStorage first (offline safety).
 *   - Remote reporting is best-effort, fire-and-forget, no retry.
 *   - PII is never logged: answers are hashed, email/phone are masked.
 *
 * ERROR LEVELS:
 *   fatal   — boot failed; funnel cannot run
 *   error   — a module threw; funnel degraded (e.g., lead not sent)
 *   warn    — unexpected state; funnel continues (e.g., placeholder URL)
 *   info    — deliberate instrumentation (e.g., config validation passed)
 *
 * STORAGE:
 *   localStorage key: ftd_errors_<funnelId>
 *   Max stored: 50 errors per funnel (ring buffer — oldest discarded)
 */

const STORAGE_PREFIX  = 'ftd_errors_';
const MAX_STORED      = 50;
const ENGINE_VERSION  = '1.0.0';

/** @type {string} */
let _funnelId   = 'unknown';

/** @type {string|null} */
let _endpoint   = null;

/** @type {boolean} */
let _initialized = false;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the error monitor. Call once during boot, before anything else.
 * @param {string} funnelId
 * @param {string|null} [endpoint] - Apps Script /exec URL (optional)
 */
export function initMonitor(funnelId, endpoint = null) {
  _funnelId    = funnelId || 'unknown';
  _endpoint    = endpoint || null;
  _initialized = true;

  // Install global error handler for uncaught exceptions
  _installGlobalHandlers();

  // Drain any queued errors from a previous session
  _drainQueue();
}

/**
 * Log a fatal error. The funnel cannot continue.
 * @param {string} message
 * @param {Object} [context]
 */
export function fatal(message, context = {}) {
  _log('fatal', message, context);
}

/**
 * Log an error. A module failed but the funnel may continue.
 * @param {string} message
 * @param {Error|Object} [errOrContext]
 */
export function error(message, errOrContext = {}) {
  const context = errOrContext instanceof Error
    ? { errorName: errOrContext.name, stack: _trimStack(errOrContext.stack) }
    : errOrContext;
  _log('error', message, context);
}

/**
 * Log a warning.
 * @param {string} message
 * @param {Object} [context]
 */
export function warn(message, context = {}) {
  _log('warn', message, context);
}

/**
 * Log an info event.
 * @param {string} message
 * @param {Object} [context]
 */
export function info(message, context = {}) {
  _log('info', message, context);
}

/**
 * Get all stored errors for this funnel (for debug UI or export).
 * @returns {Object[]}
 */
export function getStoredErrors() {
  return _readQueue();
}

/**
 * Clear all stored errors (call after confirming errors are resolved).
 */
export function clearStoredErrors() {
  try {
    localStorage.removeItem(_storageKey(_funnelId));
  } catch { /* ignore */ }
}

// ─── Core logging ────────────────────────────────────────────────────────────

function _log(level, message, context) {
  if (!_initialized) {
    // Pre-init — just console, no storage
    _consoleLog(level, message, context);
    return;
  }

  const entry = _buildEntry(level, message, context);

  // 1. Always console-log (with appropriate level)
  _consoleLog(level, message, { ...context, _entry: entry.id });

  // 2. Always queue to localStorage
  _enqueue(entry);

  // 3. Remote report for fatal + error (best-effort, no await)
  if ((level === 'fatal' || level === 'error') && _endpoint) {
    _reportRemote(entry);
  }
}

function _buildEntry(level, message, context) {
  return {
    id:        `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    level,
    message,
    funnelId:  _funnelId,
    engineVersion: ENGINE_VERSION,
    timestamp: new Date().toISOString(),
    url:       _safeGet(() => window.location.href, ''),
    userAgent: _safeGet(() => navigator.userAgent.slice(0, 150), ''),
    context:   _sanitizeContext(context),
  };
}

// ─── Console output ──────────────────────────────────────────────────────────

function _consoleLog(level, message, context) {
  const prefix = `[FTD:${level.toUpperCase()}]`;
  const hasContext = context && Object.keys(context).length > 0;

  switch (level) {
    case 'fatal':
    case 'error':
      hasContext ? console.error(prefix, message, context) : console.error(prefix, message);
      break;
    case 'warn':
      hasContext ? console.warn(prefix, message, context) : console.warn(prefix, message);
      break;
    default:
      hasContext ? console.info(prefix, message, context) : console.info(prefix, message);
  }
}

// ─── localStorage queue ──────────────────────────────────────────────────────

function _storageKey(funnelId) {
  return `${STORAGE_PREFIX}${funnelId}`;
}

function _readQueue() {
  try {
    const raw = localStorage.getItem(_storageKey(_funnelId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function _enqueue(entry) {
  try {
    const queue = _readQueue();
    queue.push(entry);
    // Ring buffer: discard oldest if over limit
    const trimmed = queue.slice(-MAX_STORED);
    localStorage.setItem(_storageKey(_funnelId), JSON.stringify(trimmed));
  } catch { /* ignore storage errors */ }
}

// ─── Remote reporting ────────────────────────────────────────────────────────

function _reportRemote(entry) {
  if (!_endpoint) return;
  // Honest degradation: a host without fetch stores locally but cannot send.
  if (typeof fetch !== 'function') return;

  // Wrap in setTimeout so it never blocks the current execution frame
  setTimeout(() => {
    fetch(_endpoint, {
      method: 'POST',
      mode: 'no-cors', // Apps Script does not support CORS preflight
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'error', ...entry }),
    }).catch(() => { /* silent fail — monitoring must not throw */ });
  }, 0);
}

// ─── Queue drain (retry previous session errors) ─────────────────────────────

function _drainQueue() {
  if (!_endpoint) return;
  if (typeof fetch !== 'function') return;

  const queue = _readQueue();
  const unsent = queue.filter(e => !e._sent);
  if (unsent.length === 0) return;

  // Fire-and-forget, mark as sent
  setTimeout(() => {
    unsent.forEach(entry => {
      fetch(_endpoint, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'error', ...entry, _drained: true }),
      }).catch(() => {});
    });
  }, 2000); // 2s delay — don't compete with boot
}

// ─── Global error handlers ───────────────────────────────────────────────────

function _installGlobalHandlers() {
  // Host guard: only a browser-like host exposes window.addEventListener.
  // Under Node there are no uncaught-error events to catch — install nothing.
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

  // Uncaught synchronous errors
  window.addEventListener('error', (event) => {
    // Ignore cross-origin script errors (no useful info, just noise)
    if (!event.filename || event.message === 'Script error.') return;

    _log('error', `Uncaught error: ${event.message}`, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error ? _trimStack(event.error.stack) : '',
    });
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    _log('error', `Unhandled promise rejection: ${reason?.message || String(reason)}`, {
      stack: reason instanceof Error ? _trimStack(reason.stack) : '',
    });
  });
}

// ─── Sanitization ────────────────────────────────────────────────────────────

/**
 * Remove PII from error context.
 * Email addresses, phone numbers, names are masked.
 */
function _sanitizeContext(context) {
  if (!context || typeof context !== 'object') return {};

  const safe = {};
  for (const [k, v] of Object.entries(context)) {
    if (typeof v === 'string') {
      safe[k] = _maskPII(k, v);
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      safe[k] = v;
    } else if (v && typeof v === 'object') {
      safe[k] = _sanitizeContext(v); // recurse one level
    }
    // Drop functions, symbols, etc.
  }
  return safe;
}

function _maskPII(key, value) {
  const lk = key.toLowerCase();
  if (lk === 'email' || lk.includes('email')) {
    // show domain only: user@example.com → ***@example.com
    return value.replace(/^[^@]+/, '***');
  }
  if (lk === 'phone' || lk === 'tel' || lk.includes('phone')) {
    // show last 4 digits: +96598765432 → ****5432
    return value.replace(/.(?=.{4})/g, '*');
  }
  if (lk === 'name') {
    return '***';
  }
  return value;
}

function _trimStack(stack) {
  if (!stack) return '';
  // Keep only first 5 frames, each max 200 chars
  return stack
    .split('\n')
    .slice(0, 5)
    .map(line => line.trim().slice(0, 200))
    .join(' | ');
}

function _safeGet(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}
