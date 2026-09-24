/**
 * xxgg-local-mode.js
 * ---------------------------------------------------------------------------
 * "Local, no-login" mode for the XXGG IELTS web port.
 *
 * Load this file as a CLASSIC script (no modules, no build step) BEFORE the
 * application bundle executes, e.g.:
 *
 *     <script src="/xxgg-runtime-config.js"></script>
 *     <script src="/xxgg-web-preload.js"></script>
 *     <script src="/xxgg-local-mode.js"></script>   <-- this file
 *     <script type="module" src="./assets/index-xxxx.js"></script>
 *
 * What it does
 *   1. If `window.__XXGG_WEB_CONFIG__.localMode === false`, it does nothing.
 *   2. If `localStorage.token` holds a REAL account token (not starting with
 *      "local-"), it does nothing - a real login always wins.
 *   3. Otherwise it installs a device-local pseudo session, patches
 *      `window.fetch`, and answers the practice API locally, backed by
 *      `localStorage["xxgg.local.v1"]`.
 *
 * It never returns HTTP 401 nor a body with `code === "401"`, because the app
 * treats either as "session expired" and force-logs-out.
 *
 * Response shapes follow the authoritative contracts in
 * `_work/contracts/me.md` and `_work/contracts/mixed.md`, which were extracted
 * from the minified production bundle:
 *   - envelope is always {"code":"200","data":<payload>,"msg":"OK"}
 *   - unit-status elements carry progressStatus / myAccuracy / averageAccuracy
 *     and a lowercase reading|listening channel
 *   - highlights GET returns {annotations:[...]}
 *   - notes GET returns {notes:[...]}; saveQuestionNote is PUT
 *   - practice-stats carries trendModel "active_day_v1"
 *   - calendar returns {days,practiceDays}; calendar-window {months,practiceDays}
 *   - records return {records,total,totalPages,pageNo,practiceDays}
 *   - compose sends NO `action` and a string[] `excludePartIds`
 *
 * Source is ASCII-only: Chinese literals are written as \uXXXX escapes.
 * Wrap-all: everything lives inside an IIFE and never throws into the app.
 */
(function () {
  'use strict';

  var W = window;
  if (!W || !W.document) return;

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  var STORE_KEY = 'xxgg.local.v1';
  var TOKEN_KEY = 'token';
  var USER_KEY = 'user';
  var LOCAL_TOKEN = 'local-device';
  var LOCAL_PREFIX = 'local-';
  var MAX_ATTEMPTS = 30;
  var MAX_PART_INDEX = 2000;
  var UPSTREAM_TIMEOUT_MS = 6000;
  var TREND_MODEL = 'active_day_v1';
  var MAX_TREND_POINTS = 6;
  var RECORDS_PAGE_SIZE = 20;
  var WINDOW_MONTHS = 12;
  var SUMMARY_EXAM_FETCH_CAP = 8;

  // Chinese literals kept as escapes so the whole file stays ASCII.
  var CN_LOCAL_NAME = '\u672c\u5730\u6a21\u5f0f';                                  // local mode
  var CN_LOCAL_DESC = '\u8bb0\u5f55\u4ec5\u4fdd\u5b58\u5728\u672c\u673a\u6d4f\u89c8\u5668'; // stored on this device
  var CN_MIXED_TITLE = '\u7ec4\u5377\u7ec3\u4e60';                                  // mixed practice
  var CN_ENTRY_LABEL = '\u53bb\u505a\u9898';                                        // go and practise
  var CN_READING = '\u9605\u8bfb';                                                  // reading
  var CN_LISTENING = '\u542c\u529b';                                                // listening
  var COLOR_READING = '#3a6ea8';
  var COLOR_LISTENING = '#7c5cbf';

  /* ------------------------------------------------------------------ */
  /* Tiny helpers - every risky operation is wrapped                     */
  /* ------------------------------------------------------------------ */
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }
  function isArray(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }
  function isPlainObject(v) {
    return v !== null && typeof v === 'object' &&
      Object.prototype.toString.call(v) === '[object Object]';
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function asArray(v) { return isArray(v) ? v : []; }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function num(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }
  function intOf(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? Math.trunc(n) : dflt;
  }
  function nowIso() { return new Date().toISOString(); }
  function tsOf(v) {
    var t = Date.parse(str(v));
    return isFinite(t) ? t : 0;
  }
  function cloneJson(v) {
    if (v === null || v === undefined) return v;
    return safe(function () { return JSON.parse(JSON.stringify(v)); }, null);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function lsGet(k) { return safe(function () { return W.localStorage.getItem(k); }, null); }
  function lsSet(k, v) { return safe(function () { W.localStorage.setItem(k, v); return true; }, false); }
  function lsDel(k) { return safe(function () { W.localStorage.removeItem(k); return true; }, false); }

  function isLocalTokenValue(v) {
    return typeof v === 'string' && v.length > 0 && v.indexOf(LOCAL_PREFIX) === 0;
  }
  function mentionsLocalToken(v) {
    return typeof v === 'string' && /local-[A-Za-z0-9_.:-]*/.test(v);
  }

  /* ---- numeric normalisation ---- */

  // 0..1 ratio -> integer 0..100.  Integer percents round-trip safely through
  // the app's `Pr()` helper (which multiplies only when 0 < x < 1).
  function pctOfRatio(r) {
    var n = Number(r);
    if (!isFinite(n)) return 0;
    if (n < 0) n = 0;
    if (n > 1) n = 1;
    return Math.max(0, Math.min(100, Math.round(n * 100)));
  }

  // Ambiguous 0..1-or-0..100 value -> integer 0..100 (mirrors the client `St`).
  function pctOfEither(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    if (n > 0 && n <= 1) n = n * 100;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function numberOrNull(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function normalizeChannel(v) {
    var t = str(v).trim().toLowerCase();
    if (t === 'reading' || t === 'listening') return t;
    if (t === '2' || t === 'read') return 'reading';
    if (t === '1' || t === 'listen') return 'listening';
    return '';
  }

  function dayKeyOf(v) {
    var raw = str(v);
    var d = new Date(raw);
    if (isFinite(d.getTime())) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    var s = raw.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function monthKeyOf(day) { return str(day).slice(0, 7); }

  function intRevision(v) {
    return Number.isInteger(v) && v > 0 ? v : 0;
  }

  /* ------------------------------------------------------------------ */
  /* Activation gate                                                     */
  /* ------------------------------------------------------------------ */
  var cfg = safe(function () { return W.__XXGG_WEB_CONFIG__ || {}; }, {}) || {};
  if (cfg.localMode === false) return;

  function disabledHandle(reason) {
    W.__xxggLocalMode = {
      enabled: false,
      reason: reason,
      store: null,
      reset: function () {},
      exportData: function () { return '{}'; },
      importData: function () { return false; },
      stats: function () { return { enabled: false, reason: reason }; }
    };
  }

  var existingToken = lsGet(TOKEN_KEY);
  if (existingToken && !isLocalTokenValue(existingToken)) {
    // A real account is signed in - local mode must stay completely out of
    // the way. We only publish a diagnostic handle.
    disabledHandle('real-account');
    return;
  }

  if (typeof W.fetch !== 'function' || typeof W.Response !== 'function') {
    disabledHandle('fetch-unsupported');
    return;
  }

  /* ------------------------------------------------------------------ */
  /* Store                                                               */
  /* ------------------------------------------------------------------ */
  function blankStore() {
    return {
      version: 2,
      attempts: {},
      units: {},       // unitId -> unit-status element (local truth)
      partIndex: {},   // partCode -> {unitId, partId, channel, partNo}
      compositions: {},
      wrongWords: [],
      notes: {},
      highlights: {},
      seq: 0
    };
  }

  var store = blankStore();

  function normalizeStore(data) {
    var out = blankStore();
    if (!isPlainObject(data)) return out;
    if (isPlainObject(data.attempts)) out.attempts = data.attempts;
    if (isPlainObject(data.units)) out.units = data.units;
    if (isPlainObject(data.partIndex)) out.partIndex = data.partIndex;
    if (isPlainObject(data.compositions)) out.compositions = data.compositions;
    if (isArray(data.wrongWords)) out.wrongWords = data.wrongWords;
    if (isPlainObject(data.notes)) out.notes = data.notes;
    if (isPlainObject(data.highlights)) out.highlights = data.highlights;
    out.seq = num(data.seq, 0);
    return out;
  }

  function replaceStoreContents(next) {
    var k;
    for (k in store) { if (has(store, k)) delete store[k]; }
    for (k in next) { if (has(next, k)) store[k] = next[k]; }
  }

  function loadStore() {
    var raw = lsGet(STORE_KEY);
    var parsed = null;
    if (raw) parsed = safe(function () { return JSON.parse(raw); }, null);
    replaceStoreContents(normalizeStore(parsed));
  }

  function dropOldestAttempt() {
    var ids = Object.keys(store.attempts);
    if (!ids.length) return false;
    var oldest = null;
    var oldestTs = Infinity;
    for (var i = 0; i < ids.length; i++) {
      var a = store.attempts[ids[i]];
      var t = tsOf(a && a.submittedAt);
      if (t < oldestTs) { oldestTs = t; oldest = ids[i]; }
    }
    if (oldest === null) return false;
    delete store.attempts[oldest];
    return true;
  }

  function capAttempts() {
    var ids = Object.keys(store.attempts);
    if (ids.length <= MAX_ATTEMPTS) return;
    var rows = [];
    for (var i = 0; i < ids.length; i++) {
      var a = store.attempts[ids[i]];
      if (a) rows.push(a);
    }
    rows.sort(function (x, y) { return tsOf(y.submittedAt) - tsOf(x.submittedAt); });
    var keep = {};
    for (var j = 0; j < rows.length && j < MAX_ATTEMPTS; j++) {
      var r = rows[j];
      var rid = str(r && (r.id || r.resultId));
      if (rid) keep[rid] = r;
    }
    store.attempts = keep;
  }

  function saveStore() {
    // Retry with progressively fewer attempts when the quota is exhausted.
    for (var attempt = 0; attempt < 8; attempt++) {
      var text = safe(function () { return JSON.stringify(store); }, null);
      if (text === null) return false;
      if (lsSet(STORE_KEY, text)) return true;
      if (!dropOldestAttempt()) return false;
    }
    return false;
  }

  function nextSeq() {
    var s = num(store.seq, 0);
    if (s < 0) s = 0;
    s = s + 1;
    store.seq = s;
    return s;
  }

  function sortedAttempts() {
    var out = [];
    var k;
    for (k in store.attempts) {
      if (has(store.attempts, k) && store.attempts[k]) out.push(store.attempts[k]);
    }
    out.sort(function (a, b) { return tsOf(b.submittedAt) - tsOf(a.submittedAt); });
    return out;
  }

  /* ---- unit / part bookkeeping ---- */

  function rememberPart(partCode, info) {
    var code = str(partCode);
    if (!code) return;
    if (Object.keys(store.partIndex).length > MAX_PART_INDEX) store.partIndex = {};
    var prev = isPlainObject(store.partIndex[code]) ? store.partIndex[code] : {};
    store.partIndex[code] = {
      unitId: str((info && info.unitId) || prev.unitId || ''),
      partId: str((info && info.partId) || prev.partId || ''),
      channel: normalizeChannel((info && info.channel) || prev.channel || ''),
      partNo: str((info && info.partNo) || prev.partNo || '')
    };
  }

  function syntheticPartCode(seed) {
    return 'PT-LOCAL-' + hash32(seed).toString(36).toUpperCase().slice(0, 8);
  }

  function unitAccuracyStats(unitId) {
    var sum = 0;
    var n = 0;
    var k;
    for (k in store.attempts) {
      if (!has(store.attempts, k)) continue;
      var a = store.attempts[k];
      if (!a || str(a.unitId) !== str(unitId)) continue;
      var v = Number(a.accuracy);
      if (isFinite(v)) { sum += v; n += 1; }
    }
    return { avg: n ? sum / n : 0, count: n };
  }

  function isUnitDone(unitId) {
    var u = store.units[str(unitId)];
    if (u && str(u.progressStatus) === 'done') return true;
    var k;
    for (k in store.attempts) {
      if (!has(store.attempts, k)) continue;
      var a = store.attempts[k];
      if (a && str(a.unitId) === str(unitId)) return true;
    }
    return false;
  }

  // Records the local "done" state for a unit after a graded attempt and
  // learns a partCode for every part so unit-status can round-trip.
  function rememberUnit(unitId, channel, examParts, fallbackParts, resultId, submittedAt) {
    var id = str(unitId);
    if (!id) return;
    var src = asArray(examParts).length ? asArray(examParts) : asArray(fallbackParts);
    var ch = normalizeChannel(channel);
    var codes = codeByPartFor(id);
    var prev = isPlainObject(store.units[id]) ? store.units[id] : null;
    var parts = [];
    var i;

    for (i = 0; i < src.length; i++) {
      var p = isPlainObject(src[i]) ? src[i] : {};
      var pid = partIdOf(p);
      var pch = normalizeChannel(p.channel) || ch || '';
      var code = str(codes[pid] || p.partCode || p.code || '');
      var pno = str(p.partNum || p.partNo || p.label || ('Part ' + (i + 1)));
      if (!pid && !code) continue;
      if (!code) code = syntheticPartCode(pid || (id + '#' + (i + 1)));
      parts.push({
        channel: pch || 'reading',
        entryLabel: CN_ENTRY_LABEL,
        entryMode: 'exam',
        entryUrl: null,
        partCode: code,
        partId: pid,
        partNo: pno
      });
      rememberPart(code, { unitId: id, partId: pid, channel: pch, partNo: pno });
    }

    if (!ch) {
      ch = (parts[0] && parts[0].channel) || (prev && normalizeChannel(prev.channel)) || 'reading';
    }
    for (i = 0; i < parts.length; i++) {
      if (!normalizeChannel(parts[i].channel)) parts[i].channel = ch;
    }

    var stats = unitAccuracyStats(id);
    store.units[id] = {
      unitId: id,
      albumId: prev ? prev.albumId : null,
      channel: ch,
      parts: parts,
      progressStatus: 'done',
      myAccuracy: pctOfRatio(stats.avg),
      averageAccuracy: pctOfRatio(stats.avg),
      resultId: str(resultId || ''),
      lastAttemptAt: str(submittedAt || ''),
      lockedForOrdinaryUsers: false,
      updatedAt: nowIso()
    };
  }

  /* ------------------------------------------------------------------ */
  /* Install the local session                                           */
  /* ------------------------------------------------------------------ */
  var localUserObject = {
    id: LOCAL_TOKEN,
    email: 'local@device',
    nickname: CN_LOCAL_NAME,
    name: CN_LOCAL_NAME,
    description: CN_LOCAL_DESC
  };

  function ensureLocalSession() {
    var token = lsGet(TOKEN_KEY);
    if (!isLocalTokenValue(token)) lsSet(TOKEN_KEY, LOCAL_TOKEN);
    var user = lsGet(USER_KEY);
    if (!user) {
      lsSet(USER_KEY, safe(function () { return JSON.stringify(localUserObject); }, '{}'));
    }
  }

  ensureLocalSession();
  loadStore();

  function fullUser() {
    var out = cloneJson(localUserObject) || {};
    out.userId = LOCAL_TOKEN;
    out.token = LOCAL_TOKEN;
    out.isLocal = true;
    out.localMode = true;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* HTTP plumbing                                                       */
  /* ------------------------------------------------------------------ */
  // Captured at load time: if xxgg-web-preload.js already wrapped fetch (for
  // the media proxy), we keep calling through it.
  var nativeFetch = W.fetch.bind(W);

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    if (input && typeof input.href === 'string') return input.href;
    return '';
  }

  function baseHref() {
    return safe(function () {
      return (W.location && W.location.href) || 'http://localhost/';
    }, 'http://localhost/');
  }

  function pathOf(url) {
    try { return new URL(url, baseHref()).pathname; } catch (e) {
      return str(url).split('?')[0].split('#')[0];
    }
  }

  function searchOf(url) {
    try { return new URL(url, baseHref()).searchParams; } catch (e) {
      return new URLSearchParams('');
    }
  }

  function methodOf(input, init) {
    if (init && init.method) return String(init.method).toUpperCase();
    if (input && typeof input !== 'string' && input.method) return String(input.method).toUpperCase();
    return 'GET';
  }

  function apiBase() {
    var c = safe(function () { return W.__APP_CONFIG__ || {}; }, {}) || {};
    var b = str(c.practiceApiBaseUrl || c.apiBaseUrl || '/api');
    while (b.length > 1 && b.charAt(b.length - 1) === '/') b = b.substring(0, b.length - 1);
    return b || '/api';
  }

  function jsonResponse(body, status) {
    var text = safe(function () { return JSON.stringify(body); }, '{"code":"200","data":null,"msg":"OK"}');
    return new W.Response(text, {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function ok(data, msg) {
    return jsonResponse({ code: '200', data: data, msg: msg || 'OK' });
  }

  // Last-resort benign payload: satisfies `.list` / `.records` / `.days`
  // readers and, above all, never carries code 401.
  function safeEnvelope() {
    return ok({ list: [], records: [], days: [], items: [], total: 0 });
  }

  function unwrap(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (has(payload, 'data') && (has(payload, 'code') || has(payload, 'msg'))) return payload.data;
    return payload;
  }

  function extractExamPayload(payload) {
    var d = unwrap(payload);
    if (isPlainObject(d) && isArray(d.parts)) return d;
    if (isPlainObject(payload) && isPlainObject(payload.result) && isArray(payload.result.parts)) {
      return payload.result;
    }
    return null;
  }

  function extractList(data) {
    if (isArray(data)) return data;
    if (!isPlainObject(data)) return [];
    if (isArray(data.list)) return data.list;
    if (isArray(data.items)) return data.items;
    if (isArray(data.units)) return data.units;
    if (isArray(data.records)) return data.records;
    return [];
  }

  function readBody(input, init) {
    return new Promise(function (resolve) {
      try {
        if (init && init.body !== undefined && init.body !== null) {
          if (typeof init.body === 'string') {
            return resolve(safe(function () { return JSON.parse(init.body); }, null));
          }
          if (typeof init.body === 'object' && typeof init.body.text === 'function') {
            init.body.text().then(function (t) {
              resolve(safe(function () { return JSON.parse(t); }, null));
            }, function () { resolve(null); });
            return;
          }
          return resolve(null);
        }
        if (input && typeof input !== 'string' &&
            typeof input.clone === 'function' && typeof input.text === 'function') {
          input.clone().text().then(function (t) {
            resolve(safe(function () { return JSON.parse(t); }, null));
          }, function () { resolve(null); });
          return;
        }
      } catch (e) { /* fall through */ }
      resolve(null);
    });
  }

  // Same-origin helper used only for read-only enrichment calls. It never
  // carries the local pseudo-token and never rejects.
  function fetchWithTimeout(url, ms, init) {
    var opts = {
      method: (init && init.method) || 'GET',
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors',
      credentials: 'omit'
    };
    if (init && init.body !== undefined) opts.body = init.body;
    var ctl = null;
    var timer = null;
    try { ctl = new W.AbortController(); } catch (e) { ctl = null; }
    if (ctl) opts.signal = ctl.signal;
    if (ctl) {
      timer = setTimeout(function () {
        safe(function () { ctl.abort(); }, null);
      }, ms || UPSTREAM_TIMEOUT_MS);
    }
    return nativeFetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      return res;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function fetchJsonWithTimeout(url, ms) {
    return fetchWithTimeout(url, ms).then(function (res) {
      if (!res || !res.ok) return null;
      return res.json().then(function (p) { return p; }, function () { return null; });
    }, function () { return null; });
  }

  /* ------------------------------------------------------------------ */
  /* Answer normalization + grading                                      */
  /* ------------------------------------------------------------------ */
  function normalizeAnswer(v) {
    return str(v).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function leadingLetter(v) {
    var m = normalizeAnswer(v).match(/^([a-z])/);
    return m ? m[1] : '';
  }

  function lettersOnly(v) {
    return normalizeAnswer(v).replace(/[^a-z]/g, '');
  }

  function answersMatch(userAnswer, rightAnswer, group) {
    var u = normalizeAnswer(userAnswer);
    var r = normalizeAnswer(rightAnswer);
    if (!r) return false;
    if (u === r) return true;

    var un = Number(u);
    var rn = Number(r);
    if (isFinite(un) && isFinite(rn) && u !== '' && r !== '' && un === rn) return true;

    var isMulti = false;
    if (group) {
      var t = normalizeAnswer(group.type);
      if (t.indexOf('multi') >= 0 || t.indexOf('multiple') >= 0) isMulti = true;
      if (group.multipleChoice === true || group.multiSelect === true) isMulti = true;
    }

    var rl = lettersOnly(r);
    var ul = lettersOnly(u);
    if (rl && ul) {
      // Single letter answer (classic A/B/C/D multiple choice).
      if (rl.length === 1) {
        if (leadingLetter(u) === rl) return true;
      }
      // Multiple letters: compare as an unordered set ("A,C" vs "CA").
      if (rl.length > 1 && rl.length <= 6) {
        var a = rl.split('').sort().join('');
        var b = ul.split('').sort().join('');
        if (a === b) return true;
      }
    }
    if (isMulti) {
      var um = leadingLetter(u);
      var rm = leadingLetter(r);
      if (um && rm && um === rm) return true;
    }
    return false;
  }

  function qNumberOf(q) {
    if (!q) return '';
    if (q.qNumber !== undefined && q.qNumber !== null && q.qNumber !== '') return str(q.qNumber);
    if (q.questionNumber !== undefined && q.questionNumber !== null && q.questionNumber !== '') return str(q.questionNumber);
    if (q.qNo !== undefined && q.qNo !== null && q.qNo !== '') return str(q.qNo);
    if (q.id !== undefined && q.id !== null) return str(q.id);
    return '';
  }

  function partIdOf(p) {
    if (!p) return '';
    if (p.id !== undefined && p.id !== null && p.id !== '') return str(p.id);
    if (p.partId !== undefined && p.partId !== null) return str(p.partId);
    return '';
  }

  function buildAnswerIndex(submittedParts) {
    var byPart = {};
    var byQ = {};
    var parts = asArray(submittedParts);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i] || {};
      var pid = partIdOf(p);
      if (!byPart[pid]) byPart[pid] = {};
      var groups = asArray(p.groups);
      for (var gi = 0; gi < groups.length; gi++) {
        var questions = asArray(groups[gi] && groups[gi].questions);
        for (var qi = 0; qi < questions.length; qi++) {
          var q = questions[qi] || {};
          var v = q.userAnswer !== undefined && q.userAnswer !== null ? q.userAnswer
            : (q.answer !== undefined && q.answer !== null ? q.answer : '');
          var qn = qNumberOf(q);
          if (qn !== '') {
            byPart[pid][qn] = v;
            byQ[qn] = v;
          }
          if (q.id !== undefined && q.id !== null && q.id !== '') byQ[str(q.id)] = v;
          if (q.questionId !== undefined && q.questionId !== null) byQ[str(q.questionId)] = v;
        }
      }
    }
    return { byPart: byPart, byQ: byQ };
  }

  function lookupAnswer(index, partId, qn, q) {
    if (index.byPart[partId] && qn !== '' && index.byPart[partId][qn] !== undefined) {
      return index.byPart[partId][qn];
    }
    if (qn !== '' && index.byQ[qn] !== undefined) return index.byQ[qn];
    if (q) {
      if (q.id !== undefined && q.id !== null && index.byQ[str(q.id)] !== undefined) return index.byQ[str(q.id)];
      if (q.questionId !== undefined && q.questionId !== null && index.byQ[str(q.questionId)] !== undefined) {
        return index.byQ[str(q.questionId)];
      }
    }
    return '';
  }

  // The review UI reads `state ?? correct ?? isCorrect` through
  // `La(e){return e===!0||e===1||e==="1"||e==="true"}` -> emit a boolean.
  function gradeExamParts(examParts, submittedParts) {
    var index = buildAnswerIndex(submittedParts);
    var parts = asArray(examParts);
    var outParts = [];
    var details = [];
    var partStats = [];
    var typeMap = {};
    var totalAll = 0;
    var correctAll = 0;

    for (var pi = 0; pi < parts.length; pi++) {
      var part = cloneJson(parts[pi]) || {};
      var pid = partIdOf(part);
      var label = str(part.partNum || part.partNo || part.label || part.title || pid);
      var pTotal = 0;
      var pCorrect = 0;
      var groups = asArray(part.groups);
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi] || {};
        var gType = str(g.type || g.questionSubtype || 'unknown') || 'unknown';
        var questions = asArray(g.questions);
        for (var qi = 0; qi < questions.length; qi++) {
          var q = questions[qi];
          if (!q || typeof q !== 'object') continue;
          var qn = qNumberOf(q);
          var ua = lookupAnswer(index, pid, qn, q);
          var right = '';
          if (q.rightAnswer !== undefined && q.rightAnswer !== null) right = q.rightAnswer;
          else if (q.correctAnswer !== undefined && q.correctAnswer !== null) right = q.correctAnswer;
          // Fallback 1: answer cache harvested from a real server-graded attempt.
          if (!str(right)) {
            try {
              var aCache = null;
              try { aCache = JSON.parse(localStorage.getItem('xxgg.answers.v1') || '{}'); } catch (e) { aCache = null; }
              if (aCache) {
                var k1 = str(q.questionId || q.id);
                var k2 = str(pid) + ':' + str(qn);
                if (k1 && aCache[k1]) right = aCache[k1];
                else if (aCache[k2]) right = aCache[k2];
              }
            } catch (e) {}
          }
          // Fallback 2: extract the answer from the public Chinese analysis text.
          if (!str(right) && window.__xxggAnswerExtract && typeof window.__xxggAnswerExtract.extract === 'function') {
            try {
              var ex = window.__xxggAnswerExtract.extract(q);
              if (ex && ex.answer) right = ex.answer;
            } catch (e) {}
          }
          var graded = !!str(right);
          var isCorrect = graded && answersMatch(ua, right, g);
          q.userAnswer = str(ua);
          q.isCorrect = isCorrect;
          q.state = isCorrect;
          q.rightAnswer = right;
          q.graded = graded;
          q.bookmarked = q.bookmarked === true;

          // Ungraded questions are excluded from accuracy denominators.
          if (graded) {
            pTotal++;
            totalAll++;
            if (isCorrect) { pCorrect++; correctAll++; }

            if (!typeMap[gType]) typeMap[gType] = { id: gType, label: gType, total: 0, correct: 0 };
            typeMap[gType].total++;
            if (isCorrect) typeMap[gType].correct++;
          }

          details.push({
            partId: pid,
            groupId: str(g.id),
            questionId: str(q.questionId !== undefined && q.questionId !== null ? q.questionId : q.id),
            id: str(q.id),
            qNumber: qn,
            questionNumber: qn,
            userAnswer: str(ua),
            answer: str(ua),
            rightAnswer: str(right),
            correctAnswer: str(right),
            isCorrect: isCorrect,
            correct: isCorrect,
            state: isCorrect,
            graded: graded
          });
        }
      }
      outParts.push(part);
      partStats.push({
        partId: pid,
        label: label,
        total: pTotal,
        correct: pCorrect,
        accuracy: pTotal ? pCorrect / pTotal : 0
      });
    }

    var typeStats = [];
    var tk;
    for (tk in typeMap) {
      if (!has(typeMap, tk)) continue;
      var t = typeMap[tk];
      t.accuracy = t.total ? t.correct / t.total : 0;
      typeStats.push(t);
    }

    return {
      parts: outParts,
      details: details,
      partStats: partStats,
      typeStats: typeStats,
      total: totalAll,
      correct: correctAll,
      score: correctAll,
      accuracy: totalAll ? correctAll / totalAll : 0
    };
  }

  // Flat review rows rebuilt from a part tree (used when no local attempt
  // exists but the composition tree does).
  function detailsFromParts(parts) {
    var out = [];
    var list = asArray(parts);
    for (var pi = 0; pi < list.length; pi++) {
      var part = list[pi] || {};
      var pid = partIdOf(part);
      var groups = asArray(part.groups);
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi] || {};
        var questions = asArray(g.questions);
        for (var qi = 0; qi < questions.length; qi++) {
          var q = questions[qi] || {};
          var qn = qNumberOf(q);
          var ua = q.userAnswer === undefined || q.userAnswer === null ? '' : q.userAnswer;
          var right = q.rightAnswer === undefined || q.rightAnswer === null ? '' : q.rightAnswer;
          var isCorrect = q.state === true || q.isCorrect === true;
          out.push({
            partId: pid,
            groupId: str(g.id),
            questionId: str(q.questionId !== undefined && q.questionId !== null ? q.questionId : q.id),
            id: str(q.id),
            qNumber: qn,
            questionNumber: qn,
            userAnswer: str(ua),
            answer: str(ua),
            rightAnswer: str(right),
            correctAnswer: str(right),
            isCorrect: isCorrect,
            correct: isCorrect,
            state: isCorrect
          });
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Caches                                                              */
  /* ------------------------------------------------------------------ */
  var examCache = {};            // unitId -> exam payload
  var requiredPartsCache = {};   // unitId -> required parts list
  var unitsCache = {};           // channel -> units list
  var compositionExamCache = {}; // compositionId -> merged exam payload

  function clearCaches() {
    examCache = {};
    requiredPartsCache = {};
    unitsCache = {};
    compositionExamCache = {};
  }

  function ensureExam(unitId) {
    var id = str(unitId);
    if (!id) return Promise.resolve(null);
    if (examCache[id]) return Promise.resolve(examCache[id]);
    var url = apiBase() + '/practice/v1/units/' + encodeURIComponent(id) + '/exam';
    return fetchJsonWithTimeout(url, UPSTREAM_TIMEOUT_MS).then(function (payload) {
      var data = extractExamPayload(payload);
      if (data) examCache[id] = data;
      return examCache[id] || null;
    });
  }

  function loadUnits(channel) {
    var key = str(channel);
    if (unitsCache[key]) return Promise.resolve(unitsCache[key]);
    var url = apiBase() + '/practice/v1/units?channel=' + encodeURIComponent(key);
    return fetchJsonWithTimeout(url, UPSTREAM_TIMEOUT_MS).then(function (payload) {
      unitsCache[key] = extractList(unwrap(payload));
      return unitsCache[key];
    }, function () {
      unitsCache[key] = [];
      return unitsCache[key];
    });
  }

  function codeByPartFor(unitId) {
    var out = {};
    var rp = requiredPartsCache[str(unitId)];
    var list = isArray(rp) ? rp : (isPlainObject(rp) && isArray(rp.list) ? rp.list : []);
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var pid = str(r.partId !== undefined && r.partId !== null ? r.partId : r.id);
      var code = str(r.partCode !== undefined && r.partCode !== null ? r.partCode : r.code);
      if (pid && code) out[pid] = code;
    }
    if (!list.length) {
      // Fall back to whatever unit-status learned earlier.
      var k;
      for (k in store.partIndex) {
        if (!has(store.partIndex, k)) continue;
        var ref = store.partIndex[k];
        if (ref && str(ref.unitId) === str(unitId) && ref.partId) out[str(ref.partId)] = str(k);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Local route table (matched on pathname suffix, origin independent)  */
  /* ------------------------------------------------------------------ */
  var ROUTES = [
    { name: 'result-review', re: /\/practice\/v1\/results\/([^/]+)\/review$/ },
    { name: 'result', re: /\/practice\/v1\/results\/([^/]+)$/ },
    { name: 'attempts', re: /\/practice\/v1\/attempts$/, methods: ['POST'] },
    { name: 'unit-status', re: /\/practice\/v1\/unit-status$/ },
    { name: 'entitlements', re: /\/practice\/v1\/me\/feature-entitlements$/ },
    { name: 'session-renew', re: /\/user-auth\/v1\/session\/renew$/, methods: ['POST'] },
    { name: 'user-info', re: /\/user\/v1\/user\/info$/ },
    { name: 'question-notes', re: /\/practice\/v1\/question-notes/ },
    { name: 'highlights', re: /\/practice\/v1\/highlights$/ },
    { name: 'wrong-words', re: /\/practice\/v1\/spelling-recall\/wrong-words$/ },
    { name: 'practice-stats', re: /\/practice\/v1\/me\/practice-stats$/ },
    { name: 'history-window', re: /\/practice\/v1\/me\/practice-history\/calendar-window$/ },
    { name: 'history-calendar', re: /\/practice\/v1\/me\/practice-history\/calendar$/ },
    { name: 'history-records', re: /\/practice\/v1\/me\/practice-history\/records$/ },
    { name: 'mixed-history', re: /\/practice\/v1\/mixed-practice\/compositions\/history$/ },
    { name: 'mixed-compose', re: /\/practice\/v1\/mixed-practice\/compose$/, methods: ['POST'] },
    { name: 'mixed-exam', re: /\/practice\/v1\/mixed-practice\/compositions\/([^/]+)\/exam$/ },
    { name: 'mixed-attempts', re: /\/practice\/v1\/mixed-practice\/compositions\/([^/]+)\/attempts$/, methods: ['POST'] },
    { name: 'mixed-review', re: /\/practice\/v1\/mixed-practice\/compositions\/([^/]+)\/review$/ }
  ];

  function matchRoute(url, method) {
    var p = pathOf(url);
    for (var i = 0; i < ROUTES.length; i++) {
      var r = ROUTES[i];
      if (r.methods && r.methods.indexOf(method) < 0) continue;
      var m = r.re.exec(p);
      if (m) return { name: r.name, params: m.slice(1) };
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Shared small helpers                                                */
  /* ------------------------------------------------------------------ */
  function splitCsv(v) {
    var out = [];
    var parts = str(v).split(',');
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].trim();
      if (t) out.push(t);
    }
    return out;
  }

  function elapsedFrom(timer, body) {
    var cands = [];
    if (isPlainObject(timer)) {
      cands.push(timer.elapsedSeconds, timer.elapsed, timer.durationSeconds, timer.duration, timer.usedSeconds);
    }
    if (isPlainObject(body)) {
      cands.push(body.elapsedSeconds, body.elapsed, body.durationSeconds);
    }
    for (var i = 0; i < cands.length; i++) {
      var v = Number(cands[i]);
      if (isFinite(v) && v >= 0) return Math.round(v);
    }
    return 0;
  }

  function partIdsOf(parts) {
    var out = [];
    var list = asArray(parts);
    for (var i = 0; i < list.length; i++) {
      var pid = partIdOf(list[i]);
      if (pid) out.push(pid);
    }
    return out;
  }

  function defaultChannel() {
    var seen = {};
    var n = 0;
    var only = '';
    var k;
    for (k in store.attempts) {
      if (!has(store.attempts, k)) continue;
      var ch = normalizeChannel(store.attempts[k] && store.attempts[k].channel);
      if (ch && !seen[ch]) { seen[ch] = 1; n += 1; only = ch; }
    }
    if (!n) {
      for (k in store.units) {
        if (!has(store.units, k)) continue;
        var u = store.units[k];
        var c2 = normalizeChannel(u && u.channel);
        if (c2 && !seen[c2]) { seen[c2] = 1; n += 1; only = c2; }
      }
    }
    return n === 1 ? only : 'reading';
  }

  /* ------------------------------------------------------------------ */
  /* Normal exam handlers                                                */
  /* ------------------------------------------------------------------ */
  function handleSubmitAttempt(ctx) {
    return ctx.body().then(function (body) {
      var b = isPlainObject(body) ? body : {};
      var unitId = str(b.unitId || b.id || b.setId);
      var channel = str(b.channel);
      var submittedAt = nowIso();
      var elapsed = elapsedFrom(b.timer, b);

      return ensureExam(unitId).then(function (exam) {
        var examParts = exam && isArray(exam.parts) ? exam.parts : [];
        var graded = gradeExamParts(examParts, b.parts);
        var seq = nextSeq();
        var resultId = 'local-att-' + seq;
        var unitTitle = str((exam && (exam.title || exam.unitTitle)) || b.unitTitle || b.title || unitId);

        var attempt = {
          id: resultId,
          resultId: resultId,
          unitId: unitId,
          channel: normalizeChannel(channel) || '',
          unitTitle: unitTitle,
          partIds: partIdsOf(examParts),
          partStats: graded.partStats,
          typeStats: graded.typeStats,
          submittedAt: submittedAt,
          elapsedSeconds: elapsed,
          score: graded.score,
          total: graded.total,
          accuracy: graded.accuracy,
          parts: graded.parts,
          details: graded.details
        };

        store.attempts[resultId] = attempt;
        rememberUnit(unitId, channel, examParts, b.parts, resultId, submittedAt);
        capAttempts();
        saveStore();

        return ok({ resultId: resultId, unitId: unitId, status: 'submitted' });
      });
    });
  }

  function findAttempt(resultId) {
    return store.attempts[str(resultId)] || null;
  }

  function handleResult(ctx) {
    var id = decodeURIComponent(str(ctx.params[0]));
    var a = findAttempt(id);
    if (!a) {
      return Promise.resolve(ok({
        result: { id: id, unitId: '' },
        attempt: { id: id, unitId: '', elapsedSeconds: 0, total: 0, score: 0 },
        parts: []
      }));
    }
    return Promise.resolve(ok({
      result: { id: id, unitId: a.unitId },
      attempt: {
        id: a.id,
        unitId: a.unitId,
        elapsedSeconds: a.elapsedSeconds,
        total: a.total,
        score: a.score
      },
      unitTitle: a.unitTitle,
      elapsedSeconds: a.elapsedSeconds,
      total: a.total,
      score: a.score,
      accuracy: a.accuracy,
      parts: a.parts || [],
      details: a.details || []
    }));
  }

  function handleResultReview(ctx) {
    var id = decodeURIComponent(str(ctx.params[0]));
    var a = findAttempt(id);
    if (!a) {
      return Promise.resolve(ok({
        result: { id: id, unitId: '' },
        attempt: { id: id, unitId: '', elapsedSeconds: 0, total: 0, score: 0 },
        unitTitle: '',
        partTitle: '',
        partNo: 1,
        parts: [],
        details: []
      }));
    }
    var parts = a.parts || [];
    var first = parts.length ? parts[0] : null;
    var partTitle = str(first && (first.title || first.titleEn || first.name));
    return Promise.resolve(ok({
      result: { id: id, unitId: a.unitId },
      attempt: {
        id: a.id,
        unitId: a.unitId,
        elapsedSeconds: a.elapsedSeconds,
        total: a.total,
        score: a.score
      },
      unitTitle: a.unitTitle,
      unitId: a.unitId,
      partTitle: partTitle,
      partNo: 1,
      channel: a.channel,
      accuracy: a.accuracy,
      submittedAt: a.submittedAt,
      parts: parts,
      details: a.details || []
    }));
  }

  /* ------------------------- unit status --------------------------- */

  function normalizeUnitEntry(raw) {
    if (!isPlainObject(raw)) return null;
    var unitId = str(raw.unitId || raw.id || '');
    var channel = normalizeChannel(raw.channel);
    var parts = [];
    var rp = asArray(raw.parts);
    var i;
    for (i = 0; i < rp.length; i++) {
      var p = isPlainObject(rp[i]) ? rp[i] : {};
      var pch = normalizeChannel(p.channel) || channel || '';
      parts.push({
        channel: pch || 'reading',
        entryLabel: str(p.entryLabel || CN_ENTRY_LABEL),
        entryMode: str(p.entryMode || 'exam'),
        entryUrl: p.entryUrl === null || p.entryUrl === undefined ? null : str(p.entryUrl),
        partCode: str(p.partCode),
        partId: str(p.partId !== undefined && p.partId !== null ? p.partId : p.id),
        partNo: str(p.partNo || p.partNum || '')
      });
    }
    if (!channel && parts.length) channel = normalizeChannel(parts[0].channel);
    return {
      albumId: raw.albumId === null || raw.albumId === undefined ? null : str(raw.albumId),
      averageAccuracy: numberOrNull(raw.averageAccuracy),
      channel: channel || 'reading',
      lastAttemptAt: raw.lastAttemptAt === null || raw.lastAttemptAt === undefined ? null : str(raw.lastAttemptAt),
      lockedForOrdinaryUsers: raw.lockedForOrdinaryUsers === true,
      myAccuracy: numberOrNull(raw.myAccuracy),
      parts: parts,
      progressStatus: str(raw.progressStatus || 'todo') || 'todo',
      resultId: raw.resultId === null || raw.resultId === undefined ? null : str(raw.resultId),
      unitId: unitId
    };
  }

  function localUnitEntry(loc) {
    var parts = [];
    var src = asArray(loc.parts);
    for (var i = 0; i < src.length; i++) {
      var p = src[i] || {};
      parts.push({
        channel: normalizeChannel(p.channel) || normalizeChannel(loc.channel) || 'reading',
        entryLabel: str(p.entryLabel || CN_ENTRY_LABEL),
        entryMode: str(p.entryMode || 'exam'),
        entryUrl: p.entryUrl === null || p.entryUrl === undefined ? null : str(p.entryUrl),
        partCode: str(p.partCode),
        partId: str(p.partId),
        partNo: str(p.partNo)
      });
    }
    return {
      albumId: loc.albumId === null || loc.albumId === undefined ? null : str(loc.albumId),
      averageAccuracy: numberOrNull(loc.averageAccuracy),
      channel: normalizeChannel(loc.channel) || (parts[0] && parts[0].channel) || 'reading',
      lastAttemptAt: loc.lastAttemptAt ? str(loc.lastAttemptAt) : null,
      lockedForOrdinaryUsers: loc.lockedForOrdinaryUsers === true,
      myAccuracy: numberOrNull(loc.myAccuracy),
      parts: parts,
      progressStatus: str(loc.progressStatus || 'done') || 'done',
      resultId: loc.resultId ? str(loc.resultId) : null,
      unitId: str(loc.unitId)
    };
  }

  function synthUnitEntry(unitId, partCode) {
    var ref = partCode ? store.partIndex[str(partCode)] : null;
    var ch = (ref && normalizeChannel(ref.channel)) || defaultChannel();
    return {
      albumId: null,
      averageAccuracy: null,
      channel: ch,
      lastAttemptAt: null,
      lockedForOrdinaryUsers: false,
      myAccuracy: null,
      parts: [{
        channel: ch,
        entryLabel: CN_ENTRY_LABEL,
        entryMode: 'exam',
        entryUrl: null,
        partCode: str(partCode || ''),
        partId: str(ref && ref.partId ? ref.partId : ''),
        partNo: str(ref && ref.partNo ? ref.partNo : 'Part 1')
      }],
      progressStatus: 'todo',
      resultId: null,
      unitId: str(unitId || (ref && ref.unitId) || '')
    };
  }

  function unitEntryKey(entry) {
    if (entry.unitId) return 'u:' + entry.unitId;
    var code = entry.parts && entry.parts[0] ? str(entry.parts[0].partCode) : '';
    return 'c:' + code;
  }

  function learnUnitEntry(entry) {
    var parts = asArray(entry.parts);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i] || {};
      if (!p.partCode) continue;
      rememberPart(p.partCode, {
        unitId: entry.unitId,
        partId: p.partId,
        channel: p.channel || entry.channel,
        partNo: p.partNo
      });
    }
  }

  function fetchUpstreamUnitStatus(partCodes, unitIds) {
    var qs = [];
    if (partCodes.length) qs.push('partCodes=' + encodeURIComponent(partCodes.join(',')));
    if (unitIds.length) qs.push('unitIds=' + encodeURIComponent(unitIds.join(',')));
    if (!qs.length) return Promise.resolve([]);
    var url = apiBase() + '/practice/v1/unit-status?' + qs.join('&');
    return fetchJsonWithTimeout(url, UPSTREAM_TIMEOUT_MS).then(function (payload) {
      var d = unwrap(payload);
      if (!isPlainObject(d) || !isArray(d.list)) return [];
      var out = [];
      for (var i = 0; i < d.list.length; i++) {
        var e = normalizeUnitEntry(d.list[i]);
        if (e) out.push(e);
      }
      return out;
    }, function () { return []; });
  }

  function buildUnitStatusList(partCodes, unitIds, upstream) {
    var out = [];
    var byKey = {};
    var matchedCodes = {};
    var matchedIds = {};
    var i;
    var j;

    function push(entry) {
      var key = unitEntryKey(entry);
      if (byKey[key]) return byKey[key];
      byKey[key] = entry;
      out.push(entry);
      if (entry.unitId) matchedIds[entry.unitId] = 1;
      for (var pi = 0; pi < entry.parts.length; pi++) {
        var code = str(entry.parts[pi].partCode);
        if (code) matchedCodes[code] = 1;
      }
      return entry;
    }

    // 1. Real upstream entries first (they carry the true channel + partIds).
    for (i = 0; i < upstream.length; i++) {
      learnUnitEntry(upstream[i]);
      push(upstream[i]);
    }

    // 2. Overlay local "done" state onto anything we know locally.
    for (i = 0; i < out.length; i++) {
      var loc = store.units[out[i].unitId];
      if (!loc) continue;
      var local = localUnitEntry(loc);
      out[i].progressStatus = local.progressStatus;
      if (local.myAccuracy !== null) out[i].myAccuracy = local.myAccuracy;
      if (local.averageAccuracy !== null) out[i].averageAccuracy = local.averageAccuracy;
      if (local.resultId !== null) out[i].resultId = local.resultId;
      if (local.lastAttemptAt !== null) out[i].lastAttemptAt = local.lastAttemptAt;
      if (!out[i].parts.length) out[i].parts = local.parts;
      for (j = 0; j < local.parts.length; j++) {
        var lp = local.parts[j];
        if (lp.partCode) matchedCodes[lp.partCode] = 1;
      }
    }

    // 3. Requested partCodes we can resolve locally.
    for (i = 0; i < partCodes.length; i++) {
      if (matchedCodes[partCodes[i]]) continue;
      var ref = store.partIndex[partCodes[i]];
      var l2 = ref && store.units[ref.unitId];
      if (l2) push(localUnitEntry(l2));
    }

    // 4. Requested unitIds we can resolve locally.
    for (i = 0; i < unitIds.length; i++) {
      if (matchedIds[unitIds[i]]) continue;
      var l3 = store.units[unitIds[i]];
      if (l3) push(localUnitEntry(l3));
    }

    // 5. Anything still unknown is answered with a benign "todo" entry so the
    //    UI always has something to index by (the real server returns an empty
    //    list, which would leave every catalogue card unresolved).
    for (i = 0; i < partCodes.length; i++) {
      if (matchedCodes[partCodes[i]]) continue;
      push(synthUnitEntry('', partCodes[i]));
    }
    for (i = 0; i < unitIds.length; i++) {
      if (matchedIds[unitIds[i]]) continue;
      push(synthUnitEntry(unitIds[i], ''));
    }

    return out;
  }

  function handleUnitStatus(ctx) {
    var partCodes = splitCsv(ctx.search.get('partCodes'));
    var unitIds = splitCsv(ctx.search.get('unitIds'));
    if (!partCodes.length && !unitIds.length) return Promise.resolve(ok({ list: [] }));
    return fetchUpstreamUnitStatus(partCodes, unitIds).then(function (upstream) {
      return ok({ list: buildUnitStatusList(partCodes, unitIds, upstream) });
    });
  }

  /* ------------------------- session / user ------------------------ */

  function handleEntitlements() {
    return Promise.resolve(ok({
      entitlements: {
        mixed_practice: true,
        high_frequency_more_rows: false
      },
      features: [
        { featureCode: 'mixed_practice', enabled: true },
        { featureCode: 'high_frequency_more_rows', enabled: false }
      ]
    }));
  }

  function handleSessionRenew() {
    return Promise.resolve(ok({ ok: true, renewed: true, mode: 'local' }));
  }

  function handleUserInfo() {
    return Promise.resolve(ok(fullUser()));
  }

  /* --------------------------- notes ------------------------------- */

  function isActiveNote(n) {
    if (!n) return false;
    if (str(n.state) === 'active') return true;
    if (!n.state && str(n.content)) return true;
    return false;
  }

  function unitQuestionOrdinals(unitId) {
    var exam = examCache[str(unitId)];
    if (!exam || !isArray(exam.parts)) return { count: 0, ordinals: [] };
    var count = 0;
    var ords = [];
    var parts = exam.parts;
    for (var pi = 0; pi < parts.length; pi++) {
      var groups = asArray(parts[pi] && parts[pi].groups);
      for (var gi = 0; gi < groups.length; gi++) {
        var questions = asArray(groups[gi] && groups[gi].questions);
        for (var qi = 0; qi < questions.length; qi++) {
          count += 1;
          var q = questions[qi] || {};
          var qid = str(q.questionId !== undefined && q.questionId !== null ? q.questionId : q.id);
          if (qid && isActiveNote(store.notes[qid])) ords.push(count);
        }
      }
    }
    if (!count) return { count: 0, ordinals: [] };
    // The validator rejects the whole batch on any violation - bail out to [].
    var prev = 0;
    for (var k = 0; k < ords.length; k++) {
      if (!Number.isInteger(ords[k]) || ords[k] < 1 || ords[k] > count || ords[k] <= prev) {
        return { count: count, ordinals: [] };
      }
      prev = ords[k];
    }
    return { count: count, ordinals: ords };
  }

  function handleCatalogSummary(ctx) {
    var unitIds = splitCsv(ctx.search.get('unitIds') || ctx.search.get('unitId') || '');
    var anyNotes = false;
    var nk;
    for (nk in store.notes) {
      if (!has(store.notes, nk)) continue;
      if (isActiveNote(store.notes[nk])) { anyNotes = true; break; }
    }
    var jobs = [];
    if (anyNotes) {
      for (var i = 0; i < unitIds.length && i < SUMMARY_EXAM_FETCH_CAP; i++) {
        if (!examCache[unitIds[i]]) jobs.push(ensureExam(unitIds[i]));
      }
    }
    return Promise.all(jobs).then(function () {
      var list = [];
      for (var j = 0; j < unitIds.length; j++) {
        var info = unitQuestionOrdinals(unitIds[j]);
        list.push({
          unitId: unitIds[j],
          questionCount: Number.isInteger(info.count) && info.count >= 0 ? info.count : 0,
          notedQuestionOrdinals: info.ordinals
        });
      }
      return ok({ list: list });
    });
  }

  function handleNotes(ctx) {
    var method = ctx.method;
    var sp = ctx.search;
    var path = ctx.path;

    if (method === 'GET' || method === 'HEAD') {
      if (path.indexOf('catalog-summary') >= 0) return handleCatalogSummary(ctx);
      var ids = splitCsv(sp.get('questionIds') || sp.get('questionId') || '');
      var notes = [];
      for (var i = 0; i < ids.length; i++) {
        var n = store.notes[ids[i]];
        if (!isActiveNote(n)) continue;
        notes.push({
          questionId: str(n.questionId || ids[i]),
          revision: intRevision(n.revision),
          content: str(n.content)
        });
      }
      return Promise.resolve(ok({ notes: notes }));
    }

    if (method === 'DELETE') {
      return ctx.body().then(function (body) {
        var b = isPlainObject(body) ? body : {};
        var qid = str(b.questionId || b.id || sp.get('questionId') || '');
        if (qid) {
          var prev = store.notes[qid];
          var prevRev = prev ? intRevision(prev.revision) : 0;
          store.notes[qid] = {
            questionId: qid,
            content: '',
            revision: prevRev + 1,
            state: 'deleted',
            updatedAt: nowIso()
          };
          saveStore();
          return ok({ state: 'deleted', revision: prevRev + 1 });
        }
        return ok({ state: 'absent', revision: 0 });
      });
    }

    // PUT (the bundle's verb) with a POST fallback.
    return ctx.body().then(function (body) {
      var b = isPlainObject(body) ? body : {};
      var qid = str(b.questionId || b.id || '');
      if (!qid) return ok({ state: 'absent', revision: 0 });

      var content = str(b.content === undefined || b.content === null ? '' : b.content).trim();
      var prev = store.notes[qid];
      var prevRev = prev ? intRevision(prev.revision) : 0;
      var baseRev = Number.isInteger(b.baseRevision) && b.baseRevision > 0 ? b.baseRevision : 0;
      var revision = Math.max(prevRev, baseRev) + 1;
      var state = content ? 'active' : 'deleted';

      store.notes[qid] = {
        questionId: qid,
        content: content,
        revision: revision,
        state: state,
        updatedAt: nowIso()
      };
      saveStore();
      return ok({ state: state, revision: revision });
    });
  }

  /* ------------------------- highlights ---------------------------- */

  function normalizeAnnotation(a, i) {
    if (!isPlainObject(a)) return null;
    var ri = isPlainObject(a.rangeInfo) ? a.rangeInfo : (isPlainObject(a.range) ? a.range : {});
    var type = str(a.type).toLowerCase() === 'note' ? 'note' : 'highlight';
    var id = str(a.id || a.highlightId || '');
    var hid = str(a.highlightId || a.id || '');
    if (!id) id = 'local-' + type + '-' + i;
    if (!hid) hid = id;
    var text = str(ri.text || a.selectedText || a.noteContent || '');
    var area = str(a.area || ri.area || 'text') || 'text';
    var rootScope = str(a.rootScope || ri.rootScope || '');
    var start = intOf(ri.start, 0);
    var end = intOf(ri.end, 0);
    var noteContent = type === 'note' ? str(a.noteContent || ri.text || '') : str(a.noteContent || '');
    return {
      id: id,
      highlightId: hid,
      type: type,
      partId: a.partId === null || a.partId === undefined ? '' : str(a.partId),
      area: area,
      rootScope: rootScope,
      selectedText: text,
      noteContent: noteContent,
      range: {
        start: start,
        end: end,
        text: text,
        area: area,
        rootScope: rootScope
      }
    };
  }

  function handleHighlights(ctx) {
    var method = ctx.method;
    var unitId = str(ctx.search.get('unitId') || '');

    if (method === 'GET' || method === 'HEAD') {
      var src = unitId && isArray(store.highlights[unitId]) ? store.highlights[unitId] : [];
      var out = [];
      for (var i = 0; i < src.length; i++) {
        var a = normalizeAnnotation(src[i], i);
        if (a) out.push(a);
      }
      return Promise.resolve(ok({ annotations: out }));
    }

    // POST: {subjectId,moduleId,unitId,examType,annotations[]} - the app always
    // sends the complete annotation set for that unit, so replace.
    return ctx.body().then(function (body) {
      var b = isPlainObject(body) ? body : {};
      var uid = str(b.unitId || unitId || '');
      var incoming = asArray(b.annotations);
      var normalized = [];
      for (var i = 0; i < incoming.length; i++) {
        var a = normalizeAnnotation(incoming[i], i);
        if (a) normalized.push(a);
      }
      if (uid) {
        store.highlights[uid] = normalized;
        saveStore();
      }
      // Callers discard the response body entirely.
      return ok({});
    });
  }

  function handleWrongWords() {
    // Dead code in the built app (no call site) - trivial stub on purpose.
    return Promise.resolve(ok({ list: [], records: [], total: 0 }));
  }

  /* --------------------------- stats ------------------------------- */

  function trendFromSamples(samples) {
    if (!samples || !samples.length) return null;
    var byDay = {};
    var i;
    for (i = 0; i < samples.length; i++) {
      var s = samples[i];
      if (!s || !s.day) continue;
      if (!byDay[s.day]) byDay[s.day] = [];
      byDay[s.day].push(Number(s.ratio) || 0);
    }
    var days = Object.keys(byDay).sort();
    if (!days.length) return null;
    if (days.length > MAX_TREND_POINTS) days = days.slice(days.length - MAX_TREND_POINTS);
    var points = [];
    for (i = 0; i < days.length; i++) {
      var arr = byDay[days[i]];
      var sum = 0;
      for (var j = 0; j < arr.length; j++) sum += arr[j];
      points.push({ day: days[i], accuracy: pctOfRatio(arr.length ? sum / arr.length : 0) });
    }
    return points.length ? { points: points } : null;
  }

  function mapStats(map, withSubs) {
    var out = [];
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      var e = map[keys[i]];
      var avgRatio = e.n ? e.sum / e.n : 0;
      var item = {
        id: e.id,
        label: e.label,
        accuracy: pctOfRatio(avgRatio),
        avg: pctOfRatio(avgRatio),
        attempted: e.n,
        trend: trendFromSamples(e.samples)
      };
      if (withSubs) item.subs = [];
      out.push(item);
    }
    return out;
  }

  function buildStatsSection(channel, asc) {
    var label = channel === 'listening' ? CN_LISTENING : CN_READING;
    var color = channel === 'listening' ? COLOR_LISTENING : COLOR_READING;
    var mine = [];
    var i;
    var j;
    for (i = 0; i < asc.length; i++) {
      if (normalizeChannel(asc[i].channel) === channel) mine.push(asc[i]);
    }
    if (!mine.length) {
      return {
        label: label,
        color: color,
        total: null,
        avgTotal: null,
        attempted: 0,
        parts: [],
        types: [],
        trend: null
      };
    }

    var sum = 0;
    var sectionSamples = [];
    var partMap = {};
    var typeMap = {};

    for (i = 0; i < mine.length; i++) {
      var a = mine[i];
      var day = dayKeyOf(a.submittedAt);
      var ratio = Number(a.accuracy);
      if (!isFinite(ratio)) ratio = 0;
      sum += ratio;
      if (day) sectionSamples.push({ day: day, ratio: ratio });

      var ps = asArray(a.partStats);
      for (j = 0; j < ps.length; j++) {
        var p = ps[j] || {};
        var pid = str(p.partId);
        if (!pid) continue;
        if (!partMap[pid]) partMap[pid] = { id: pid, label: str(p.label || pid), samples: [], sum: 0, n: 0 };
        var pr = Number(p.accuracy) || 0;
        partMap[pid].sum += pr;
        partMap[pid].n += 1;
        if (day) partMap[pid].samples.push({ day: day, ratio: pr });
      }

      var ts = asArray(a.typeStats);
      for (j = 0; j < ts.length; j++) {
        var t = ts[j] || {};
        var tid = str(t.id || t.label);
        if (!tid) continue;
        if (!typeMap[tid]) typeMap[tid] = { id: tid, label: str(t.label || tid), samples: [], sum: 0, n: 0 };
        var tr = Number(t.accuracy) || 0;
        typeMap[tid].sum += tr;
        typeMap[tid].n += 1;
        if (day) typeMap[tid].samples.push({ day: day, ratio: tr });
      }
    }

    var last = mine[mine.length - 1];
    var lastRatio = Number(last.accuracy);
    if (!isFinite(lastRatio)) lastRatio = 0;

    return {
      label: label,
      color: color,
      total: pctOfRatio(lastRatio),
      avgTotal: pctOfRatio(sum / mine.length),
      attempted: mine.length,
      parts: mapStats(partMap, false),
      types: mapStats(typeMap, true),
      trend: trendFromSamples(sectionSamples)
    };
  }

  function handlePracticeStats() {
    var desc = sortedAttempts();
    var asc = desc.slice().reverse(); // oldest first
    return Promise.resolve(ok({
      trendModel: TREND_MODEL,
      reading: buildStatsSection('reading', asc),
      listening: buildStatsSection('listening', asc)
    }));
  }

  /* ------------------------- history ------------------------------- */

  function attemptsByDay() {
    var map = {};
    var all = sortedAttempts();
    for (var i = 0; i < all.length; i++) {
      var d = dayKeyOf(all[i].submittedAt);
      if (!d) continue;
      map[d] = (map[d] || 0) + 1;
    }
    return map;
  }

  function calendarDays() {
    var map = attemptsByDay();
    var days = Object.keys(map).sort();
    var out = [];
    for (var i = 0; i < days.length; i++) {
      out.push({ date: days[i], hasRecords: true, workloadCount: map[days[i]] });
    }
    return out;
  }

  function practiceDaysCount() {
    return Object.keys(attemptsByDay()).length;
  }

  function handleHistoryCalendar() {
    var days = calendarDays();
    return Promise.resolve(ok({ days: days, practiceDays: days.length }));
  }

  function handleHistoryCalendarWindow() {
    var days = calendarDays();
    var byMonth = {};
    var i;
    for (i = 0; i < days.length; i++) {
      var mk = monthKeyOf(days[i].date);
      if (!byMonth[mk]) byMonth[mk] = [];
      byMonth[mk].push(days[i]);
    }
    var now = new Date();
    var months = [];
    for (i = WINDOW_MONTHS - 1; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
      months.push({ month: key, days: byMonth[key] || [] });
    }
    // HTTP 200 matters: a 404 here is a "handled fallback" path in the app.
    return Promise.resolve(ok({ months: months, practiceDays: practiceDaysCount() }));
  }

  function singleAttemptToRecord(a) {
    var ch = normalizeChannel(a.channel) || 'reading';
    var unitId = str(a.unitId);
    var stats = unitAccuracyStats(unitId);
    var title = str(a.unitTitle || unitId);
    return {
      recordId: str(a.id),
      channel: ch,
      recordType: 'single_unit',
      titleEn: title,
      displayTitle: title,
      titleZh: null,
      accuracy: pctOfRatio(a.accuracy),
      averageAccuracy: stats.count ? pctOfRatio(stats.avg) : pctOfRatio(a.accuracy),
      availabilityStatus: 'available',
      canOpenReview: true,
      canRedo: true,
      reviewTarget: { type: 'single_attempt', attemptId: str(a.id), unitId: unitId },
      redoTarget: { type: 'unit_exam', unitId: unitId },
      unitId: unitId,
      completedAt: str(a.submittedAt),
      items: []
    };
  }

  function mixedAttemptToRecord(a) {
    var comp = isPlainObject(store.compositions[a.compositionId]) ? store.compositions[a.compositionId] : null;
    var ch = normalizeChannel(a.channel) ||
      (comp ? normalizeChannel(comp.channel) : '') || 'reading';
    var slots = comp ? asArray(comp.slots) : [];
    var items = [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i] || {};
      var uid = str(s.unitId || '');
      var pid = str(s.partId || s.id || '');
      var acc = null;
      var ps = asArray(a.partStats);
      for (var j = 0; j < ps.length; j++) {
        if (str(ps[j] && ps[j].partId) === pid) { acc = Number(ps[j].accuracy); break; }
      }
      if (acc === null || !isFinite(acc)) {
        acc = asArray(a.details).length ? 0 : Number(a.accuracy) || 0;
      }
      items.push({
        partLabel: str(s.slot || ('P' + (i + 1))),
        partNo: i + 1,
        partCode: str(s.partCode || ''),
        titleEn: str(s.titleEn || s.title || ''),
        titleZh: s.titleZh === null || s.titleZh === undefined ? null : str(s.titleZh),
        accuracy: pctOfRatio(acc),
        averageAccuracy: pctOfRatio(acc),
        availabilityStatus: 'available',
        canOpenReview: true,
        canRedo: true,
        reviewTarget: { type: 'single_attempt', attemptId: str(a.id), unitId: uid },
        redoTarget: { type: 'unit_exam', unitId: uid },
        originalUnitId: uid,
        originalAlbumId: null,
        compositionPartId: str(s.slot || ('cp-' + (i + 1))),
        slot: str(s.slot || ''),
        partId: pid
      });
    }
    return {
      recordId: str(a.id),
      channel: ch,
      recordType: 'mixed_practice',
      titleEn: CN_MIXED_TITLE,
      displayTitle: CN_MIXED_TITLE,
      titleZh: null,
      accuracy: pctOfRatio(a.accuracy),
      averageAccuracy: pctOfRatio(a.accuracy),
      availabilityStatus: 'available',
      canOpenReview: true,
      canRedo: false,
      reviewTarget: null,
      redoTarget: null,
      unitId: '',
      completedAt: str(a.submittedAt),
      items: items
    };
  }

  function attemptToRecord(a) {
    if (a && a.compositionId) return mixedAttemptToRecord(a);
    return singleAttemptToRecord(a);
  }

  function handleHistoryRecords(ctx) {
    var date = str(ctx.search.get('date') || '');
    var pageNo = Math.max(1, intOf(ctx.search.get('pageNo'), 1));
    var pageSize = Math.max(1, intOf(ctx.search.get('pageSize'), RECORDS_PAGE_SIZE));

    var attempts = sortedAttempts();
    if (date) {
      attempts = attempts.filter(function (a) { return dayKeyOf(a.submittedAt) === date; });
    }
    var total = attempts.length;
    var totalPages = Math.max(1, Math.ceil(total / pageSize));
    var page = Math.min(pageNo, totalPages);
    var slice = attempts.slice((page - 1) * pageSize, page * pageSize);

    var records = [];
    for (var i = 0; i < slice.length; i++) {
      var rec = attemptToRecord(slice[i]);
      if (rec) records.push(rec);
    }

    return Promise.resolve(ok({
      records: records,
      total: total,
      totalPages: totalPages,
      pageNo: page,
      practiceDays: practiceDaysCount()
    }));
  }

  /* ------------------------- mixed practice ------------------------ */

  function hash32(input) {
    var s = str(input);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h = (h ^ s.charCodeAt(i)) >>> 0;
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function shuffleInPlace(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function slotCountFor(channel) {
    return channel === 'listening' ? 4 : 3;
  }

  function handleCompose(ctx) {
    return ctx.body().then(function (body) {
      var b = isPlainObject(body) ? body : {};
      var channel = normalizeChannel(b.channel) || 'reading';
      // `preferHighFrequency` forces difficulty to "random" (literal client).
      var preferHighFrequency = b.preferHighFrequency === true;
      var difficulty = preferHighFrequency
        ? 'random'
        : (str(b.difficulty || 'random') || 'random');
      var onlyUndone = b.onlyUndone === true;
      var seed = str(b.seed === undefined || b.seed === null ? '' : b.seed);
      var shortageFallbackConfirmed = b.shortageFallbackConfirmed === true;
      var prevId = str(b.previousCompositionId || '');

      // `excludePartIds` is a string[] on the wire (never a "a|b" string).
      var exclude = {};
      var ex = asArray(b.excludePartIds);
      var i;
      for (i = 0; i < ex.length; i++) {
        var t = str(ex[i]).trim();
        if (t) exclude[t] = 1;
      }
      if (prevId && isPlainObject(store.compositions[prevId])) {
        var prevSlots = asArray(store.compositions[prevId].slots);
        for (i = 0; i < prevSlots.length; i++) {
          var ps = prevSlots[i] || {};
          if (ps.partId) exclude[str(ps.partId)] = 1;
          if (ps.unitId) exclude[str(ps.unitId)] = 1;
        }
      }

      var need = slotCountFor(channel);

      return loadUnits(channel).then(function (units) {
        var pool = [];
        for (i = 0; i < units.length; i++) {
          var u = isPlainObject(units[i]) ? units[i] : {};
          var id = str(u.id !== undefined && u.id !== null ? u.id : u.unitId);
          if (!id) continue;
          var titleEn = str(
            u.titleEn !== undefined && u.titleEn !== null ? u.titleEn :
              (u.title !== undefined && u.title !== null ? u.title :
                (u.subtitle !== undefined && u.subtitle !== null ? u.subtitle : id))
          );
          var titleZh = u.titleZh === null || u.titleZh === undefined ? null : str(u.titleZh);
          var avgRaw = u.avgAccuracy !== undefined && u.avgAccuracy !== null ? u.avgAccuracy : u.avgAcc;
          pool.push({
            unitId: id,
            titleEn: titleEn,
            titleZh: titleZh,
            avgPct: pctOfEither(avgRaw === undefined || avgRaw === null ? 0.5 : avgRaw),
            channel: normalizeChannel(u.channel) || channel
          });
        }

        function notExcluded(c) { return !exclude[c.unitId]; }
        var primary = pool.filter(function (c) {
          return notExcluded(c) && !(onlyUndone && isUnitDone(c.unitId));
        });
        var secondary = pool.filter(notExcluded);

        var rnd = makeRng(hash32(seed + '|' + channel + '|' + difficulty + '|' + (onlyUndone ? '1' : '0') +
          '|' + (preferHighFrequency ? '1' : '0')));
        var warning = null;
        var chosen = primary.slice();
        shuffleInPlace(chosen, rnd);
        if (preferHighFrequency) {
          chosen.sort(function (x, y) { return (y.avgPct || 0) - (x.avgPct || 0); });
        }

        if (chosen.length < need && shortageFallbackConfirmed) {
          // The "difficulty-matched completed parts" fallback the app offers.
          var extra = secondary.filter(function (c) { return !isUnitDone(c.unitId); });
          var merged = chosen.slice();
          for (i = 0; i < extra.length && merged.length < need; i++) merged.push(extra[i]);
          if (merged.length > chosen.length) { warning = 'MIXED_PRACTICE_REPEAT_ALLOWED'; }
          chosen = merged;
        }
        if (chosen.length < need) {
          // Last resort: reuse the whole pool rather than failing the compose.
          var seen = {};
          for (i = 0; i < chosen.length; i++) seen[chosen[i].unitId] = 1;
          for (i = 0; i < pool.length && chosen.length < need; i++) {
            if (seen[pool[i].unitId]) continue;
            seen[pool[i].unitId] = 1;
            chosen.push(pool[i]);
            warning = warning || 'MIXED_PRACTICE_REPEAT_ALLOWED';
          }
        }

        chosen = chosen.slice(0, need);

        return Promise.all(chosen.map(function (c) { return ensureExam(c.unitId); })).then(function (exams) {
          var slots = [];
          for (i = 0; i < chosen.length; i++) {
            var c = chosen[i];
            var exam = exams[i];
            var part = exam && isArray(exam.parts) && exam.parts.length ? exam.parts[0] : null;
            var realPartId = part ? partIdOf(part) : '';
            var en = c.titleEn;
            var zh = c.titleZh;
            if (part) {
              if (!en || en === c.unitId) en = str(part.title || part.titleEn || en);
              if (zh === null && part.titleZh !== undefined && part.titleZh !== null) zh = str(part.titleZh);
            }
            var name = 'P' + (i + 1);
            slots.push({
              slot: name,
              partNo: name,
              partId: realPartId || c.unitId,
              id: realPartId || c.unitId,
              unitId: c.unitId,
              titleEn: en || '\u2014',
              title: en || '\u2014',
              titleZh: zh,
              titleCn: zh,
              avgAccuracy: c.avgPct,
              avgAcc: c.avgPct,
              channel: c.channel || channel
            });
          }

          var seq = nextSeq();
          var compositionId = 'local-mix-' + seq;
          store.compositions[compositionId] = {
            id: compositionId,
            compositionId: compositionId,
            createdAt: nowIso(),
            channel: channel,
            difficulty: difficulty,
            onlyUndone: onlyUndone,
            preferHighFrequency: preferHighFrequency,
            seed: seed,
            slots: slots,
            parts: []
          };
          saveStore();

          return ok({
            compositionId: compositionId,
            slots: slots,
            warningCode: warning
          });
        });
      });
    });
  }

  function resolveCompositionParts(id) {
    var comp = isPlainObject(store.compositions[id]) ? store.compositions[id] : null;
    if (!comp) return Promise.resolve(null);
    if (isArray(comp.parts) && comp.parts.length) return Promise.resolve(comp.parts);
    if (compositionExamCache[id] && isArray(compositionExamCache[id].parts) &&
        compositionExamCache[id].parts.length) {
      return Promise.resolve(compositionExamCache[id].parts);
    }
    var slots = asArray(comp.slots);
    return Promise.all(slots.map(function (s) {
      return ensureExam(str(s && (s.unitId || s.partId)));
    })).then(function (exams) {
      var parts = [];
      for (var i = 0; i < slots.length; i++) {
        var slot = slots[i] || {};
        var uid = str(slot.unitId || slot.partId || '');
        var exam = exams[i];
        var up = exam && isArray(exam.parts) ? exam.parts : [];
        for (var j = 0; j < up.length; j++) {
          var p = cloneJson(up[j]) || {};
          var pno = 'Part ' + (i + 1);
          p.partNum = pno;
          p.partNo = pno;
          p.slot = str(slot.slot || ('P' + (i + 1)));
          p.partId = partIdOf(p);
          if (p.id === undefined || p.id === null) p.id = p.partId;
          p.originalUnitId = uid;
          p.unitId = uid;
          parts.push(p);
        }
      }
      comp.parts = parts;
      saveStore();
      return parts;
    });
  }

  function handleMixedExam(ctx) {
    var id = decodeURIComponent(str(ctx.params[0]));
    var comp = isPlainObject(store.compositions[id]) ? store.compositions[id] : null;

    function payload(parts) {
      var originalParents = [];
      var list = asArray(parts);
      for (var i = 0; i < list.length; i++) {
        var pid = partIdOf(list[i]);
        var uid = str(list[i] && list[i].originalUnitId);
        if (pid && uid) originalParents.push({ partId: pid, originalUnitId: uid });
      }
      return {
        id: id,
        compositionId: id,
        unitId: id,
        setId: id,
        sessionType: 'mixed',
        channel: comp ? str(comp.channel) : '',
        title: CN_MIXED_TITLE,
        parts: list,
        originalParents: originalParents
      };
    }

    if (!comp) {
      return Promise.resolve(ok(payload([])));
    }
    return resolveCompositionParts(id).then(function (parts) {
      var out = payload(parts || []);
      compositionExamCache[id] = out;
      return ok(out);
    });
  }

  function handleMixedAttempts(ctx) {
    var id = decodeURIComponent(str(ctx.params[0]));
    return ctx.body().then(function (body) {
      var b = isPlainObject(body) ? body : {};
      return resolveCompositionParts(id).then(function (parts) {
        var comp = isPlainObject(store.compositions[id]) ? store.compositions[id] : null;
        // Mixed submit body is {channel, parts, timer?} - no unitId/compositionId.
        var graded = gradeExamParts(parts || [], b.parts);
        var seq = nextSeq();
        var resultId = 'local-mix-att-' + seq;
        var submittedAt = nowIso();
        var channel = normalizeChannel(b.channel) ||
          (comp ? normalizeChannel(comp.channel) : '') || 'reading';

        store.attempts[resultId] = {
          id: resultId,
          resultId: resultId,
          unitId: '',
          compositionId: id,
          channel: channel,
          unitTitle: CN_MIXED_TITLE,
          partIds: partIdsOf(parts),
          partStats: graded.partStats,
          typeStats: graded.typeStats,
          submittedAt: submittedAt,
          elapsedSeconds: elapsedFrom(b.timer, b),
          score: graded.score,
          total: graded.total,
          accuracy: graded.accuracy,
          parts: graded.parts,
          details: graded.details
        };
        if (comp) comp.lastAttemptId = resultId;
        capAttempts();
        saveStore();

        // The submit guard needs data.compositionId AND status==="submitted".
        return ok({ compositionId: id, status: 'submitted', resultId: resultId });
      });
    });
  }

  function handleMixedReview(ctx) {
    var id = decodeURIComponent(str(ctx.params[0]));
    var comp = isPlainObject(store.compositions[id]) ? store.compositions[id] : null;

    return resolveCompositionParts(id).then(function (parts) {
      var found = null;
      var attempts = sortedAttempts();
      for (var i = 0; i < attempts.length; i++) {
        if (str(attempts[i].compositionId) === id) { found = attempts[i]; break; }
      }
      var useParts = found && isArray(found.parts) && found.parts.length ? found.parts : (parts || []);

      var children = [];
      var slots = comp ? asArray(comp.slots) : [];
      for (var j = 0; j < slots.length; j++) {
        var s = slots[j] || {};
        children.push({
          slot: str(s.slot || ('P' + (j + 1))),
          partNo: 'Part ' + (j + 1),
          partId: str(s.partId || s.id || ''),
          originalUnitId: str(s.unitId || '')
        });
      }
      if (!children.length) {
        for (var k = 0; k < useParts.length; k++) {
          var p = useParts[k] || {};
          children.push({
            slot: str(p.slot || ('P' + (k + 1))),
            partNo: str(p.partNum || ('Part ' + (k + 1))),
            partId: partIdOf(p),
            originalUnitId: str(p.originalUnitId || '')
          });
        }
      }

      var details = found && isArray(found.details) && found.details.length
        ? found.details
        : detailsFromParts(useParts);

      return ok({
        compositionId: id,
        id: id,
        sessionType: 'mixed',
        title: CN_MIXED_TITLE,
        unitTitle: CN_MIXED_TITLE,
        elapsedSeconds: found ? num(found.elapsedSeconds, 0) : 0,
        total: found ? num(found.total, 0) : 0,
        score: found ? num(found.score, 0) : 0,
        accuracy: found ? num(found.accuracy, 0) : 0,
        children: children,
        parts: useParts,
        details: details
      });
    });
  }

  function handleMixedHistory() {
    // Dead code in the built app (no call site) - trivial stub on purpose.
    return Promise.resolve(ok({ list: [], records: [], total: 0 }));
  }

  /* ------------------------------------------------------------------ */
  /* Dispatch                                                            */
  /* ------------------------------------------------------------------ */
  function dispatch(name, ctx) {
    switch (name) {
      case 'result-review': return handleResultReview(ctx);
      case 'result': return handleResult(ctx);
      case 'attempts': return handleSubmitAttempt(ctx);
      case 'unit-status': return handleUnitStatus(ctx);
      case 'entitlements': return handleEntitlements(ctx);
      case 'session-renew': return handleSessionRenew(ctx);
      case 'user-info': return handleUserInfo(ctx);
      case 'question-notes': return handleNotes(ctx);
      case 'highlights': return handleHighlights(ctx);
      case 'wrong-words': return handleWrongWords(ctx);
      case 'practice-stats': return handlePracticeStats(ctx);
      case 'history-window': return handleHistoryCalendarWindow(ctx);
      case 'history-calendar': return handleHistoryCalendar(ctx);
      case 'history-records': return handleHistoryRecords(ctx);
      case 'mixed-compose': return handleCompose(ctx);
      case 'mixed-exam': return handleMixedExam(ctx);
      case 'mixed-attempts': return handleMixedAttempts(ctx);
      case 'mixed-review': return handleMixedReview(ctx);
      case 'mixed-history': return handleMixedHistory(ctx);
      default: return Promise.resolve(safeEnvelope());
    }
  }

  /* ------------------------------------------------------------------ */
  /* fetch patch                                                         */
  /* ------------------------------------------------------------------ */
  function scrubLocalToken(input, init) {
    var headers;
    try {
      if (init && init.headers) headers = new W.Headers(init.headers);
      else if (input && typeof input !== 'string' && input.headers) headers = new W.Headers(input.headers);
      else return { input: input, init: init };
    } catch (e) {
      return { input: input, init: init };
    }

    var toDelete = [];
    safe(function () {
      headers.forEach(function (value, name) {
        var lower = str(name).toLowerCase();
        if (lower === 'token' || lower === 'authorization' || lower === 'x-token') {
          if (isLocalTokenValue(value) || mentionsLocalToken(value)) toDelete.push(name);
        } else if (mentionsLocalToken(value)) {
          toDelete.push(name);
        }
      });
    }, null);

    if (!toDelete.length) return { input: input, init: init };

    for (var i = 0; i < toDelete.length; i++) {
      safe(function () { headers.delete(toDelete[i]); }, null);
    }

    var newInit = null;
    if (isPlainObject(init)) {
      newInit = {};
      for (var k in init) { if (has(init, k)) newInit[k] = init[k]; }
      newInit.headers = headers;
    } else if (init === undefined || init === null) {
      newInit = { headers: headers };
    } else {
      newInit = init;
    }

    var newInput = input;
    if (input && typeof input !== 'string' && typeof input.url === 'string') {
      newInput = safe(function () {
        return new W.Request(input, { headers: headers });
      }, input.url);
    }
    return { input: newInput, init: newInit };
  }

  function observePassthrough(promise, rawUrl, method) {
    return promise.then(function (res) {
      if (!res) return res;
      safe(function () {
        if (method === 'GET' && res.ok) {
          var m = /\/practice\/v1\/units\/([^/]+)\/exam$/.exec(pathOf(rawUrl));
          if (m) {
            var uid = decodeURIComponent(m[1]);
            res.clone().json().then(function (payload) {
              var data = extractExamPayload(payload);
              if (data) examCache[uid] = data;
            }, function () { /* ignore */ });
          }
          var rp = /\/practice\/v1\/units\/([^/]+)\/required-parts$/.exec(pathOf(rawUrl));
          if (rp) {
            var rid = decodeURIComponent(rp[1]);
            res.clone().json().then(function (payload) {
              var d = unwrap(payload);
              var list = isArray(d) ? d : (isPlainObject(d) && isArray(d.list) ? d.list : null);
              if (!list) return;
              requiredPartsCache[rid] = list;
              for (var i = 0; i < list.length; i++) {
                var r = list[i] || {};
                var code = str(r.partCode !== undefined && r.partCode !== null ? r.partCode : r.code);
                if (!code) continue;
                rememberPart(code, {
                  unitId: rid,
                  partId: str(r.partId !== undefined && r.partId !== null ? r.partId : r.id),
                  channel: normalizeChannel(r.channel),
                  partNo: str(r.partNo || r.partNum || '')
                });
              }
              saveStore();
            }, function () { /* ignore */ });
          }
        }
      }, null);

      if (res.status === 401) return safeEnvelope();

      var ct = '';
      try { ct = str(res.headers.get('content-type')); } catch (e) { ct = ''; }
      if (ct.indexOf('json') >= 0) {
        return res.clone().json().then(function (body) {
          if (body && str(body.code) === '401') return safeEnvelope();
          return res;
        }, function () { return res; });
      }
      return res;
    });
  }

  function patchedFetch(input, init) {
    var rawUrl = '';
    var method = 'GET';
    try {
      rawUrl = urlOf(input);
      method = methodOf(input, init);
    } catch (e) {
      rawUrl = '';
      method = 'GET';
    }

    var route = null;
    try { route = rawUrl ? matchRoute(rawUrl, method) : null; } catch (e) { route = null; }

    if (route) {
      var ctx = {
        method: method,
        url: rawUrl,
        path: pathOf(rawUrl),
        search: searchOf(rawUrl),
        params: route.params,
        input: input,
        init: init,
        body: function () { return readBody(input, init); }
      };
      return Promise.resolve()
        .then(function () { return dispatch(route.name, ctx); })
        .then(function (res) { return res || safeEnvelope(); },
              function () { return safeEnvelope(); });
    }

    var scrubbed;
    try { scrubbed = scrubLocalToken(input, init); }
    catch (e) { scrubbed = { input: input, init: init }; }

    var promise;
    try {
      promise = nativeFetch(scrubbed.input, scrubbed.init);
    } catch (e) {
      return Promise.reject(e);
    }
    return observePassthrough(promise, rawUrl, method);
  }

  try {
    W.fetch = patchedFetch;
  } catch (e) {
    // Cannot patch: leave the app untouched.
  }

  /* ------------------------------------------------------------------ */
  /* Public diagnostics handle                                           */
  /* ------------------------------------------------------------------ */
  function doReset() {
    replaceStoreContents(blankStore());
    clearCaches();
    lsDel(STORE_KEY);
    ensureLocalSession();
    saveStore();
    return true;
  }

  function exportData() {
    return safe(function () { return JSON.stringify(store); }, '{}');
  }

  function importData(json) {
    var parsed = safe(function () {
      return typeof json === 'string' ? JSON.parse(json) : json;
    }, null);
    if (!isPlainObject(parsed)) return false;
    replaceStoreContents(normalizeStore(parsed));
    clearCaches();
    saveStore();
    return true;
  }

  function statsSnapshot() {
    var attempts = sortedAttempts();
    var byChannel = {};
    var total = 0;
    var correct = 0;
    var i;
    for (i = 0; i < attempts.length; i++) {
      var a = attempts[i];
      var t = num(a.total, 0);
      var sc = num(a.score, 0);
      total += t;
      correct += sc;
      var ch = normalizeChannel(a.channel) || 'unknown';
      if (!byChannel[ch]) byChannel[ch] = { attempts: 0, totalQuestions: 0, correctQuestions: 0, accuracy: 0 };
      byChannel[ch].attempts += 1;
      byChannel[ch].totalQuestions += t;
      byChannel[ch].correctQuestions += sc;
    }
    var k;
    for (k in byChannel) {
      if (!has(byChannel, k)) continue;
      var c = byChannel[k];
      c.accuracy = c.totalQuestions ? c.correctQuestions / c.totalQuestions : 0;
    }
    return {
      totalAttempts: attempts.length,
      totalQuestions: total,
      correctQuestions: correct,
      byChannel: byChannel
    };
  }

  function stats() {
    var s = statsSnapshot();
    s.enabled = true;
    s.token = lsGet(TOKEN_KEY) || '';
    s.attemptsStored = Object.keys(store.attempts).length;
    s.unitsStored = Object.keys(store.units).length;
    s.partCodesStored = Object.keys(store.partIndex).length;
    s.compositionsStored = Object.keys(store.compositions).length;
    s.notesStored = Object.keys(store.notes).length;
    s.updatedAt = nowIso();
    return s;
  }

  W.__xxggLocalMode = {
    enabled: true,
    store: store,
    reset: doReset,
    exportData: exportData,
    importData: importData,
    stats: stats
  };

  if (cfg.debug) {
    safe(function () {
      console.info('[xxgg-local-mode] enabled', { apiBase: apiBase(), token: lsGet(TOKEN_KEY) });
    }, null);
  }
})();
