/**
 * xxgg-server-compose.js
 * ---------------------------------------------------------------------------
 * Local paper composition ("zu juan") with SERVER grading, for REAL accounts.
 *
 * Why this file exists
 *   The vendor gates the mixed-practice (zu juan) feature behind a per-account
 *   entitlement (`mixed_practice`). Accounts without that entitlement still want
 *   to compose a paper and have it graded. This module composes the paper locally
 *   from the PUBLIC unit catalogue, then submits each slot to the ORDINARY
 *   practice endpoint (which is gated only by login), harvests the server's
 *   authoritative `rightAnswer` values from the result review, and grades the
 *   composed paper locally from those answers.
 *
 * Activation
 *   - `window.__XXGG_WEB_CONFIG__.serverCompose === false` disables the module.
 *   - Only a REAL session is served: `localStorage.token` must exist and must NOT
 *     start with "local-". Otherwise every request is passed through untouched.
 *
 * Intercepted paths (pathname-suffix match, so both the GitHub Pages absolute API
 * base and the self-hosted "/api" proxy base work):
 *   GET  /practice/v1/me/feature-entitlements
 *   POST /practice/v1/mixed-practice/compose
 *   GET  /practice/v1/mixed-practice/compositions/history
 *   GET  /practice/v1/mixed-practice/compositions/<id>/exam
 *   POST /practice/v1/mixed-practice/compositions/<id>/attempts
 *   GET  /practice/v1/mixed-practice/compositions/<id>/review
 * Nothing else is intercepted: ordinary submits, ordinary results and ordinary
 * reviews keep going to the real server unchanged.
 *
 * This file never emits HTTP 401 nor a body carrying code "401", because the app
 * treats either as "session expired" and force-logs-out.
 *
 * Storage keys
 *   xxgg.servercompose.v1  composed papers: slot -> source unitId, per-part
 *                          per-question provenance, the graded attempt tree and
 *                          the flat review rows.
 *   xxgg.answers.v1        harvested `rightAnswer` cache. `xxgg-local-mode.js`
 *                          keeps NO answer cache of its own (its store key is
 *                          `xxgg.local.v1` and it grades from the exam payload),
 *                          so this module owns a dedicated key.
 *
 * Source is ASCII-only: Chinese literals are written as \uXXXX escapes.
 * Everything lives inside an IIFE and never throws into the app.
 */
(function () {
  'use strict';

  var W = window;
  if (!W || !W.document) return;

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */
  var MODULE_VERSION = 1;
  var TOKEN_KEY = 'token';
  var USER_KEY = 'user';
  var LOCAL_PREFIX = 'local-';
  var COMPOSE_KEY = 'xxgg.servercompose.v1';
  var ANSWERS_KEY = 'xxgg.answers.v1';

  // Chinese literals kept as escapes so the whole file stays ASCII.
  var CN_MIXED_TITLE = '\u7ec4\u5377\u7ec3\u4e60';                    // 组卷练习
  var CN_READING = '\u9605\u8bfb';                                     // 阅读
  var CN_LISTENING = '\u542c\u529b';                                   // 听力

  var SLOTS_READING = 3;
  var SLOTS_LISTENING = 4;
  var MAX_POOL = 400;
  var UNIT_STATUS_CHUNK = 50;
  var UNIT_STATUS_MAX_IDS = 300;
  var UNIT_STATUS_TTL_MS = 120000;
  var UPSTREAM_TIMEOUT_MS = 60000;
  var UNIT_STATUS_TIMEOUT_MS = 15000;
  var MAX_CACHED_COMPOSITIONS = 40;

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
  function cloneJson(v) {
    if (v === null || v === undefined) return v;
    return safe(function () { return JSON.parse(JSON.stringify(v)); }, null);
  }

  function lsGet(k) { return safe(function () { return W.localStorage.getItem(k); }, null); }
  function lsSet(k, v) { return safe(function () { W.localStorage.setItem(k, v); return true; }, false); }
  function lsDel(k) { return safe(function () { W.localStorage.removeItem(k); return true; }, false); }

  function readToken() { return str(lsGet(TOKEN_KEY)); }
  function isRealToken(t) {
    return typeof t === 'string' && t.length > 0 && t.indexOf(LOCAL_PREFIX) !== 0;
  }
  function hasRealSession() { return isRealToken(readToken()); }

  function normalizeChannel(v) {
    var t = str(v).trim().toLowerCase();
    if (t === 'reading' || t === 'listening') return t;
    if (t === '2' || t === 'read') return 'reading';
    if (t === '1' || t === 'listen') return 'listening';
    return '';
  }

  function pctOfEither(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    if (n > 0 && n <= 1) n = n * 100;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function hash32(input) {
    var s = str(input);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h = (h ^ s.charCodeAt(i)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
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

  /* ------------------------------------------------------------------ */
  /* Activation gate                                                     */
  /* ------------------------------------------------------------------ */
  var webCfg = safe(function () { return W.__XXGG_WEB_CONFIG__ || {}; }, {}) || {};

  function publishHandle(enabled, reason) {
    W.__xxggServerCompose = {
      version: MODULE_VERSION,
      enabled: enabled === true,
      reason: reason || '',
      apiBase: function () { return apiBase(); },
      hasRealSession: hasRealSession,
      store: function () { return cloneJson(composeStore); },
      answers: function () { return cloneJson(answerCache); },
      stats: function () { return statsSnapshot(); },
      reset: function () {
        composeStore = blankComposeStore();
        answerCache = blankAnswers();
        lsDel(COMPOSE_KEY);
        lsDel(ANSWERS_KEY);
        saveComposeStore();
        saveAnswers();
        return true;
      }
    };
  }

  if (webCfg.serverCompose === false) {
    publishHandle(false, 'disabled-by-config');
    return;
  }

  if (typeof W.fetch !== 'function' || typeof W.Response !== 'function') {
    publishHandle(false, 'fetch-unsupported');
    return;
  }

  // Captured before we patch, so upstream calls never re-enter our interceptor.
  // If xxgg-web-preload.js already wrapped fetch (media proxy) we keep calling
  // through it.
  var nativeFetch = safe(function () { return W.fetch.bind(W); }, null);
  if (typeof nativeFetch !== 'function') {
    publishHandle(false, 'fetch-unsupported');
    return;
  }

  /* ------------------------------------------------------------------ */
  /* HTTP plumbing                                                       */
  /* ------------------------------------------------------------------ */
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
    var b = str(c.practiceApiBaseUrl || c.apiBaseUrl || c.userAuthApiBaseUrl || '/api');
    while (b.length > 1 && b.charAt(b.length - 1) === '/') b = b.substring(0, b.length - 1);
    return b || '/api';
  }

  function jsonResponse(body, status) {
    var text = safe(function () { return JSON.stringify(body); },
      '{"code":"200","data":null,"msg":"OK"}');
    return new W.Response(text, {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  function ok(data, msg) {
    return jsonResponse({ code: '200', data: data, msg: msg || 'OK' });
  }

  function fail(msg, status) {
    return jsonResponse({ code: str(status || 500), msg: str(msg), data: null }, status || 500);
  }

  function unwrap(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    if (has(payload, 'data') && (has(payload, 'code') || has(payload, 'msg'))) return payload.data;
    return payload;
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

  function extractExamPayload(payload) {
    var d = unwrap(payload);
    if (isPlainObject(d) && isArray(d.parts)) return d;
    if (isPlainObject(payload) && isPlainObject(payload.result) && isArray(payload.result.parts)) {
      return payload.result;
    }
    return null;
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

  // Calls the REAL server with the REAL account token. Returns a settled
  // descriptor so callers never have to deal with rejections.
  function requestUpstream(url, init, timeoutMs) {
    var opts = {
      method: (init && init.method) || 'GET',
      headers: {},
      mode: 'cors',
      credentials: 'omit'
    };
    var tk = readToken();
    if (isRealToken(tk)) opts.headers.token = tk;
    if (init && isPlainObject(init.headers)) {
      for (var k in init.headers) {
        if (has(init.headers, k) && init.headers[k] !== undefined && init.headers[k] !== null) {
          opts.headers[k] = str(init.headers[k]);
        }
      }
    }
    if (init && init.body !== undefined && init.body !== null) {
      opts.body = init.body;
      if (!opts.headers['Content-Type'] && !opts.headers['content-type']) {
        opts.headers['Content-Type'] = 'application/json';
      }
    }

    var ctl = null;
    var timer = null;
    try { ctl = new W.AbortController(); } catch (e) { ctl = null; }
    if (ctl) opts.signal = ctl.signal;
    if (ctl) {
      timer = setTimeout(function () {
        safe(function () { ctl.abort(); }, null);
      }, timeoutMs || UPSTREAM_TIMEOUT_MS);
    }

    return nativeFetch(url, opts).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res) return { ok: false, status: 0, data: null, raw: null };
      return res.text().then(function (t) {
        var raw = null;
        try { raw = t ? JSON.parse(t) : null; } catch (e) { raw = null; }
        var codeOk = raw === null || raw === undefined ||
          str(raw.code) === '200' || raw.code === 200;
        return {
          ok: res.ok === true && codeOk,
          status: res.status,
          data: unwrap(raw),
          raw: raw
        };
      }, function () {
        return { ok: res.ok === true, status: res.status, data: null, raw: null };
      });
    }, function () {
      if (timer) clearTimeout(timer);
      return { ok: false, status: 0, data: null, raw: null };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Storage: composed papers                                            */
  /* ------------------------------------------------------------------ */
  function blankComposeStore() {
    return { version: 1, seq: 0, compositions: {}, doneUnits: {} };
  }

  function blankAnswers() {
    return { version: 1, updatedAt: '', byQuestionId: {}, byUnitQ: {} };
  }

  var composeStore = blankComposeStore();
  var answerCache = blankAnswers();

  function normalizeComposeStore(data) {
    var out = blankComposeStore();
    if (!isPlainObject(data)) return out;
    if (isPlainObject(data.compositions)) out.compositions = data.compositions;
    if (isPlainObject(data.doneUnits)) out.doneUnits = data.doneUnits;
    out.seq = num(data.seq, 0);
    return out;
  }

  function loadComposeStore() {
    var raw = lsGet(COMPOSE_KEY);
    var parsed = raw ? safe(function () { return JSON.parse(raw); }, null) : null;
    composeStore = normalizeComposeStore(parsed);
  }

  function pruneCompositions() {
    var ids = Object.keys(composeStore.compositions);
    if (ids.length <= MAX_CACHED_COMPOSITIONS) return;
    var rows = [];
    for (var i = 0; i < ids.length; i++) {
      var c = composeStore.compositions[ids[i]];
      rows.push({ id: ids[i], t: Date.parse(str(c && c.createdAt)) || 0 });
    }
    rows.sort(function (a, b) { return b.t - a.t; });
    var keep = {};
    for (var j = 0; j < rows.length && j < MAX_CACHED_COMPOSITIONS; j++) keep[rows[j].id] = 1;
    for (var k = 0; k < ids.length; k++) {
      if (!keep[ids[k]]) delete composeStore.compositions[ids[k]];
    }
  }

  function saveComposeStore() {
    pruneCompositions();
    for (var attempt = 0; attempt < 4; attempt++) {
      var text = safe(function () { return JSON.stringify(composeStore); }, null);
      if (text === null) return false;
      if (lsSet(COMPOSE_KEY, text)) return true;
      // Quota exhausted: drop the oldest composition and retry.
      var ids = Object.keys(composeStore.compositions);
      if (!ids.length) return false;
      var oldest = null;
      var oldestTs = Infinity;
      for (var i = 0; i < ids.length; i++) {
        var c = composeStore.compositions[ids[i]];
        var t = Date.parse(str(c && c.createdAt)) || 0;
        if (t < oldestTs) { oldestTs = t; oldest = ids[i]; }
      }
      if (oldest === null) return false;
      delete composeStore.compositions[oldest];
    }
    return false;
  }

  function nextCompositionSeq() {
    var s = num(composeStore.seq, 0);
    if (s < 0) s = 0;
    s = s + 1;
    composeStore.seq = s;
    return s;
  }

  function getComposition(id) {
    var key = str(id);
    var c = composeStore.compositions[key];
    return isPlainObject(c) ? c : null;
  }

  function loadAnswers() {
    var raw = lsGet(ANSWERS_KEY);
    var parsed = raw ? safe(function () { return JSON.parse(raw); }, null) : null;
    var out = blankAnswers();
    if (isPlainObject(parsed)) {
      if (isPlainObject(parsed.byQuestionId)) out.byQuestionId = parsed.byQuestionId;
      if (isPlainObject(parsed.byUnitQ)) out.byUnitQ = parsed.byUnitQ;
      out.updatedAt = str(parsed.updatedAt);
    }
    answerCache = out;
  }

  function saveAnswers() {
    answerCache.updatedAt = nowIso();
    var text = safe(function () { return JSON.stringify(answerCache); }, null);
    if (text === null) return false;
    return lsSet(ANSWERS_KEY, text);
  }

  function answerCount() {
    return Object.keys(answerCache.byQuestionId).length +
      Object.keys(answerCache.byUnitQ).length;
  }

  function answerLookup(unitId, qNumber, questionId) {
    if (questionId && has(answerCache.byQuestionId, questionId)) {
      return answerCache.byQuestionId[questionId];
    }
    if (unitId && qNumber) {
      var k = unitId + '::' + qNumber;
      if (has(answerCache.byUnitQ, k)) return answerCache.byUnitQ[k];
    }
    return '';
  }

  loadComposeStore();
  loadAnswers();

  /* ------------------------------------------------------------------ */
  /* Grading helpers                                                     */
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

  function singleMatch(u, r, group) {
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
      if (rl.length === 1) {
        if (leadingLetter(u) === rl) return true;
      }
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

  // A server `rightAnswer` may hold several accepted alternatives separated by
  // "|" or ";". Try each one.
  function answersMatch(userAnswer, rightAnswer, group) {
    var u = normalizeAnswer(userAnswer);
    var r = normalizeAnswer(rightAnswer);
    if (!r) return false;
    if (singleMatch(u, r, group)) return true;
    var alts = r.split(/[|;]/);
    for (var i = 1; i < alts.length; i++) {
      var a = alts[i].trim();
      if (a && singleMatch(u, a, group)) return true;
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

  function questionIdOf(q) {
    if (!q) return '';
    if (q.questionId !== undefined && q.questionId !== null && q.questionId !== '') return str(q.questionId);
    if (q.id !== undefined && q.id !== null && q.id !== '') return str(q.id);
    return '';
  }

  function buildSubmittedIndex(submittedParts) {
    var byPartQ = {};
    var byQid = {};
    var list = asArray(submittedParts);
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var pid = partIdOf(p);
      if (!byPartQ[pid]) byPartQ[pid] = {};
      var groups = asArray(p.groups);
      for (var gi = 0; gi < groups.length; gi++) {
        var qs = asArray(groups[gi] && groups[gi].questions);
        for (var qi = 0; qi < qs.length; qi++) {
          var q = qs[qi] || {};
          var v = q.userAnswer !== undefined && q.userAnswer !== null ? q.userAnswer
            : (q.answer !== undefined && q.answer !== null ? q.answer : '');
          var qn = qNumberOf(q);
          if (qn !== '') byPartQ[pid][qn] = v;
          var qid = questionIdOf(q);
          if (qid) byQid[qid] = v;
          if (qn !== '') byQid['qn:' + qn] = v;
        }
      }
    }
    return { byPartQ: byPartQ, byQid: byQid };
  }

  function lookupSubmitted(index, partId, qn, q) {
    if (index.byPartQ[partId] && qn !== '' && index.byPartQ[partId][qn] !== undefined) {
      return index.byPartQ[partId][qn];
    }
    var qid = questionIdOf(q);
    if (qid && index.byQid[qid] !== undefined) return index.byQid[qid];
    if (qn !== '' && index.byQid['qn:' + qn] !== undefined) return index.byQid['qn:' + qn];
    return '';
  }

  // Annotate the merged exam tree with the user's answers and the server's
  // harvested right answers. Returns { parts, details, total, correct, accuracy }.
  function gradeComposition(examParts, submittedParts) {
    var index = buildSubmittedIndex(submittedParts);
    var parts = asArray(examParts);
    var outParts = [];
    var details = [];
    var total = 0;
    var correct = 0;

    for (var pi = 0; pi < parts.length; pi++) {
      var part = cloneJson(parts[pi]) || {};
      var pid = partIdOf(part);
      var uid = str(part.originalUnitId || part.unitId || '');
      var groups = asArray(part.groups);
      for (var gi = 0; gi < groups.length; gi++) {
        var g = groups[gi] || {};
        var questions = asArray(g.questions);
        for (var qi = 0; qi < questions.length; qi++) {
          var q = questions[qi];
          if (!q || typeof q !== 'object') continue;
          var qn = qNumberOf(q);
          var qid = questionIdOf(q);
          var ua = lookupSubmitted(index, pid, qn, q);
          var right = answerLookup(uid, qn, qid);
          var isCorrect = answersMatch(ua, right, g);

          q.userAnswer = str(ua);
          q.rightAnswer = str(right);
          q.isCorrect = isCorrect;
          q.correct = isCorrect;
          q.state = isCorrect;
          q.bookmarked = q.bookmarked === true;

          total++;
          if (isCorrect) correct++;

          details.push({
            qNumber: qn,
            questionNumber: qn,
            partId: pid,
            groupId: str(g.id),
            userAnswer: str(ua),
            answer: str(ua),
            state: isCorrect,
            isCorrect: isCorrect,
            correct: isCorrect,
            rightAnswer: str(right),
            correctAnswer: str(right),
            questionId: qid,
            id: str(q.id === undefined || q.id === null ? '' : q.id)
          });
        }
      }
      outParts.push(part);
    }

    return {
      parts: outParts,
      details: details,
      total: total,
      correct: correct,
      accuracy: total ? correct / total : 0
    };
  }

  // Flat rows rebuilt straight from a part tree (used when no graded attempt
  // exists yet, so the review payload is never empty).
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
            qNumber: qn,
            questionNumber: qn,
            partId: pid,
            groupId: str(g.id),
            userAnswer: str(ua),
            answer: str(ua),
            state: isCorrect,
            isCorrect: isCorrect,
            correct: isCorrect,
            rightAnswer: str(right),
            correctAnswer: str(right),
            questionId: questionIdOf(q),
            id: str(q.id === undefined || q.id === null ? '' : q.id)
          });
        }
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Caches                                                              */
  /* ------------------------------------------------------------------ */
  var unitsCache = {};           // channel -> Promise<unit[]>
  var unitExamCache = {};        // unitId -> exam payload
  var unitStatusCache = {};      // channel -> {at, map}

  function invalidateCaches() {
    unitsCache = {};
    unitExamCache = {};
    unitStatusCache = {};
  }

  function loadUnits(channel) {
    var key = normalizeChannel(channel) || 'reading';
    if (unitsCache[key]) return unitsCache[key];
    var url = apiBase() + '/practice/v1/units?channel=' + encodeURIComponent(key);
    unitsCache[key] = requestUpstream(url, { method: 'GET' }, UPSTREAM_TIMEOUT_MS)
      .then(function (res) {
        var list = res && res.ok ? extractList(res.data) : [];
        var out = [];
        for (var i = 0; i < list.length && out.length < MAX_POOL; i++) {
          var u = isPlainObject(list[i]) ? list[i] : {};
          var id = str(u.id !== undefined && u.id !== null ? u.id : u.unitId);
          if (!id) continue;
          out.push({
            unitId: id,
            titleEn: str(u.titleEn !== undefined && u.titleEn !== null ? u.titleEn
              : (u.title !== undefined && u.title !== null ? u.title
                : (u.subtitle !== undefined && u.subtitle !== null ? u.subtitle : id))),
            titleZh: u.titleZh === null || u.titleZh === undefined ? '' : str(u.titleZh),
            channel: normalizeChannel(u.channel) || key
          });
        }
        return out;
      }, function () { return []; });
    return unitsCache[key];
  }

  function ensureUnitExam(unitId) {
    var id = str(unitId);
    if (!id) return Promise.resolve(null);
    if (unitExamCache[id]) return Promise.resolve(unitExamCache[id]);
    var url = apiBase() + '/practice/v1/units/' + encodeURIComponent(id) + '/exam';
    return requestUpstream(url, { method: 'GET' }, UPSTREAM_TIMEOUT_MS).then(function (res) {
      var data = res && res.ok ? extractExamPayload(res.raw) : null;
      if (data) unitExamCache[id] = data;
      return unitExamCache[id] || null;
    }, function () { return null; });
  }

  function fetchUnitStatus(channel, unitIds) {
    var key = normalizeChannel(channel) || 'reading';
    var cached = unitStatusCache[key];
    if (cached && (Date.now() - cached.at) < UNIT_STATUS_TTL_MS) {
      return Promise.resolve(cached.map);
    }
    var ids = asArray(unitIds).slice(0, UNIT_STATUS_MAX_IDS);
    if (!ids.length) return Promise.resolve({});

    var chunks = [];
    for (var i = 0; i < ids.length; i += UNIT_STATUS_CHUNK) {
      chunks.push(ids.slice(i, i + UNIT_STATUS_CHUNK));
    }

    var map = {};
    var chain = Promise.resolve();
    for (var c = 0; c < chunks.length; c++) {
      chain = chain.then((function (chunk) {
        return function () {
          var url = apiBase() + '/practice/v1/unit-status?unitIds=' +
            encodeURIComponent(chunk.join(','));
          return requestUpstream(url, { method: 'GET' }, UNIT_STATUS_TIMEOUT_MS)
            .then(function (res) {
              var d = res && res.ok ? res.data : null;
              var list = isPlainObject(d) && isArray(d.list) ? d.list : [];
              for (var j = 0; j < list.length; j++) {
                var e = isPlainObject(list[j]) ? list[j] : {};
                var uid = str(e.unitId !== undefined && e.unitId !== null ? e.unitId : e.id);
                if (!uid) continue;
                map[uid] = {
                  progressStatus: str(e.progressStatus || ''),
                  myAccuracy: pctOfEither(e.myAccuracy),
                  averageAccuracy: pctOfEither(e.averageAccuracy),
                  resultId: e.resultId === null || e.resultId === undefined ? '' : str(e.resultId)
                };
              }
            }, function () { /* ignore chunk */ });
        };
      })(chunks[c]));
    }

    return chain.then(function () {
      unitStatusCache[key] = { at: Date.now(), map: map };
      return map;
    }, function () {
      unitStatusCache[key] = { at: Date.now(), map: map };
      return map;
    });
  }

  function isUnitDone(unitId, statusMap) {
    var id = str(unitId);
    if (composeStore.doneUnits[id] === 1) return true;
    var s = statusMap && statusMap[id];
    if (!s) return false;
    if (s.progressStatus === 'done') return true;
    if (s.resultId) return true;
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Composition: merged exam + provenance                               */
  /* ------------------------------------------------------------------ */
  function buildCompositionExam(id) {
    var comp = getComposition(id);
    if (!comp) return Promise.resolve(null);
    if (isPlainObject(comp.exam) && isArray(comp.exam.parts) && comp.exam.parts.length) {
      return Promise.resolve(comp.exam);
    }

    var slots = asArray(comp.slots);
    if (!slots.length) return Promise.resolve(null);

    var jobs = [];
    for (var i = 0; i < slots.length; i++) {
      jobs.push(ensureUnitExam(str(slots[i] && (slots[i].unitId || slots[i].partId || slots[i].id))));
    }

    return Promise.all(jobs).then(function (exams) {
      var parts = [];
      var originalParents = [];
      var partUnits = {};
      var groupUnits = {};
      var questionUnits = {};

      for (var si = 0; si < slots.length; si++) {
        var slot = slots[si] || {};
        var uid = str(slot.unitId || slot.partId || slot.id || '');
        var exam = exams[si];
        var up = exam && isArray(exam.parts) ? exam.parts : [];
        for (var j = 0; j < up.length; j++) {
          var p = cloneJson(up[j]) || {};
          var pid = partIdOf(p);
          if (!pid) continue;
          var slotName = str(slot.slot || ('P' + (si + 1)));
          var label = 'Part ' + (parts.length + 1);

          p.slot = slotName;
          p.partNum = label;
          p.partNo = label;
          p.originalPartNum = str(up[j] && (up[j].partNum || up[j].partNo));
          p.id = pid;
          p.partId = pid;
          p.originalUnitId = uid;
          p.unitId = uid;

          partUnits[pid] = uid;
          originalParents.push({ partId: pid, originalUnitId: uid });

          if (!questionUnits[pid]) questionUnits[pid] = {};
          var groups = asArray(p.groups);
          for (var gi = 0; gi < groups.length; gi++) {
            var g = groups[gi] || {};
            var gid = str(g.id);
            if (gid) groupUnits[gid] = uid;
            var questions = asArray(g.questions);
            for (var qi = 0; qi < questions.length; qi++) {
              var q = questions[qi] || {};
              var qn = qNumberOf(q);
              var qid = questionIdOf(q);
              if (qn) questionUnits[pid][qn] = uid;
              if (qid) questionUnits[pid][qid] = uid;
            }
          }
          parts.push(p);
        }
      }

      var payload = {
        id: id,
        compositionId: id,
        unitId: id,
        setId: id,
        sessionType: 'mixed',
        title: CN_MIXED_TITLE,
        channel: str(comp.channel || ''),
        parts: parts,
        originalParents: originalParents
      };

      comp.exam = payload;
      comp.partUnits = partUnits;
      comp.groupUnits = groupUnits;
      comp.questionUnits = questionUnits;
      saveComposeStore();
      return payload;
    });
  }

  function ensureCompositionExam(id) {
    return buildCompositionExam(id);
  }

  /* ------------------------------------------------------------------ */
  /* 1. feature entitlements                                             */
  /* ------------------------------------------------------------------ */
  function handleEntitlements() {
    return Promise.resolve(jsonResponse({
      code: '200',
      data: {
        entitlements: {
          mixed_practice: true,
          high_frequency_more_rows: false
        },
        features: [
          { featureCode: 'mixed_practice', enabled: true }
        ]
      },
      msg: 'OK'
    }));
  }

  /* ------------------------------------------------------------------ */
  /* 2. compose                                                          */
  /* ------------------------------------------------------------------ */
  function slotCountFor(channel) {
    return channel === 'listening' ? SLOTS_LISTENING : SLOTS_READING;
  }

  function handleCompose(ctx) {
    return readBody(ctx.input, ctx.init).then(function (body) {
      var b = isPlainObject(body) ? body : {};
      var channel = normalizeChannel(b.channel) || 'reading';
      var preferHighFrequency = b.preferHighFrequency === true;
      // `preferHighFrequency` forces difficulty to "random" (literal client).
      var difficulty = preferHighFrequency ? 'random' : (str(b.difficulty || 'random') || 'random');
      var onlyUndone = b.onlyUndone === true;
      var seed = str(b.seed === undefined || b.seed === null ? '' : b.seed);
      var shortageFallbackConfirmed = b.shortageFallbackConfirmed === true;
      var prevId = str(b.previousCompositionId || '');

      var exclude = {};
      var ex = asArray(b.excludePartIds);
      var i;
      for (i = 0; i < ex.length; i++) {
        var t = str(ex[i]).trim();
        if (t) exclude[t] = 1;
      }
      if (prevId) {
        var prev = getComposition(prevId);
        var prevSlots = prev ? asArray(prev.slots) : [];
        for (i = 0; i < prevSlots.length; i++) {
          var ps = prevSlots[i] || {};
          if (ps.partId) exclude[str(ps.partId)] = 1;
          if (ps.id) exclude[str(ps.id)] = 1;
          if (ps.unitId) exclude[str(ps.unitId)] = 1;
        }
      }

      var need = slotCountFor(channel);

      return loadUnits(channel).then(function (units) {
        var ids = [];
        for (i = 0; i < units.length; i++) ids.push(units[i].unitId);

        var statusJob = onlyUndone ? fetchUnitStatus(channel, ids) : Promise.resolve({});

        return statusJob.then(function (statusMap) {
          var pool = [];
          for (i = 0; i < units.length; i++) {
            var u = units[i];
            var s = statusMap[u.unitId];
            pool.push({
              unitId: u.unitId,
              titleEn: u.titleEn,
              titleZh: u.titleZh,
              channel: u.channel || channel,
              avgPct: s && s.averageAccuracy !== null && s.averageAccuracy !== undefined
                ? s.averageAccuracy : 50,
              done: isUnitDone(u.unitId, statusMap)
            });
          }

          function notExcluded(c) { return !exclude[c.unitId]; }
          var primary = [];
          var secondary = [];
          for (i = 0; i < pool.length; i++) {
            if (!notExcluded(pool[i])) continue;
            secondary.push(pool[i]);
            if (!(onlyUndone && pool[i].done)) primary.push(pool[i]);
          }

          var rnd = makeRng(hash32(
            seed + '|' + channel + '|' + difficulty + '|' + (onlyUndone ? '1' : '0') +
            '|' + (preferHighFrequency ? '1' : '0')
          ));

          var warning = null;
          var chosen = primary.slice();
          shuffleInPlace(chosen, rnd);
          if (preferHighFrequency) {
            chosen.sort(function (x, y) { return (y.avgPct || 0) - (x.avgPct || 0); });
          }

          if (chosen.length < need && shortageFallbackConfirmed) {
            var merged = chosen.slice();
            var seen = {};
            for (i = 0; i < merged.length; i++) seen[merged[i].unitId] = 1;
            for (i = 0; i < secondary.length && merged.length < need; i++) {
              if (seen[secondary[i].unitId]) continue;
              seen[secondary[i].unitId] = 1;
              merged.push(secondary[i]);
            }
            if (merged.length > chosen.length) warning = 'MIXED_PRACTICE_REPEAT_ALLOWED';
            chosen = merged;
          }

          if (chosen.length < need) {
            // Last resort: reuse the whole pool rather than failing the compose.
            var seen2 = {};
            for (i = 0; i < chosen.length; i++) seen2[chosen[i].unitId] = 1;
            for (i = 0; i < pool.length && chosen.length < need; i++) {
              if (seen2[pool[i].unitId]) continue;
              seen2[pool[i].unitId] = 1;
              chosen.push(pool[i]);
              warning = warning || 'MIXED_PRACTICE_REPEAT_ALLOWED';
            }
          }

          chosen = chosen.slice(0, need);

          var slots = [];
          for (i = 0; i < chosen.length; i++) {
            var c = chosen[i];
            var name = 'P' + (i + 1);
            slots.push({
              slot: name,
              partNo: name,
              partId: c.unitId,
              id: c.unitId,
              unitId: c.unitId,
              titleEn: c.titleEn || '\u2014',
              title: c.titleEn || '\u2014',
              titleZh: c.titleZh || null,
              titleCn: c.titleZh || null,
              avgAccuracy: c.avgPct,
              avgAcc: c.avgPct,
              channel: c.channel || channel
            });
          }

          var seq = nextCompositionSeq();
          var compositionId = 'local-mix-' + seq;
          composeStore.compositions[compositionId] = {
            id: compositionId,
            compositionId: compositionId,
            createdAt: nowIso(),
            channel: channel,
            difficulty: difficulty,
            onlyUndone: onlyUndone,
            preferHighFrequency: preferHighFrequency,
            seed: seed,
            slots: slots,
            partUnits: {},
            groupUnits: {},
            questionUnits: {},
            exam: null,
            attempt: null
          };
          saveComposeStore();

          return ok({
            compositionId: compositionId,
            slots: slots,
            warningCode: warning
          });
        });
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 3. exam                                                             */
  /* ------------------------------------------------------------------ */
  function handleMixedExam(ctx) {
    var id = decodeURIComponent(str(ctx.params[0]));
    var comp = getComposition(id);
    if (!comp) {
      return Promise.resolve(ok({
        id: id,
        compositionId: id,
        unitId: id,
        setId: id,
        sessionType: 'mixed',
        title: CN_MIXED_TITLE,
        channel: '',
        parts: [],
        originalParents: []
      }));
    }
    return ensureCompositionExam(id).then(function (exam) {
      if (!exam) return ok({
        id: id,
        compositionId: id,
        unitId: id,
        setId: id,
        sessionType: 'mixed',
        title: CN_MIXED_TITLE,
        channel: str(comp.channel || ''),
        parts: [],
        originalParents: []
      });
      return ok(exam);
    });
  }

  /* ------------------------------------------------------------------ */
  /* 4. attempts (CORE)                                                  */
  /* ------------------------------------------------------------------ */
  function buildUnitResolver(comp, examParts) {
    var partUnits = {};
    var groupUnits = {};
    var k;

    var storedParts = isPlainObject(comp && comp.partUnits) ? comp.partUnits : {};
    for (k in storedParts) { if (has(storedParts, k)) partUnits[k] = str(storedParts[k]); }
    var storedGroups = isPlainObject(comp && comp.groupUnits) ? comp.groupUnits : {};
    for (k in storedGroups) { if (has(storedGroups, k)) groupUnits[k] = str(storedGroups[k]); }

    var list = asArray(examParts);
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var pid = partIdOf(p);
      var uid = str(p.originalUnitId || p.unitId || '');
      if (pid && uid && !partUnits[pid]) partUnits[pid] = uid;
      var groups = asArray(p.groups);
      for (var gi = 0; gi < groups.length; gi++) {
        var gid = str(groups[gi] && groups[gi].id);
        if (gid && uid && !groupUnits[gid]) groupUnits[gid] = uid;
      }
    }

    var distinct = [];
    var seenU = {};
    for (k in partUnits) {
      if (!has(partUnits, k)) continue;
      var v = partUnits[k];
      if (v && !seenU[v]) { seenU[v] = 1; distinct.push(v); }
    }

    return function resolve(part) {
      var pid = partIdOf(part);
      if (pid && partUnits[pid]) return partUnits[pid];
      var groups = asArray(part && part.groups);
      for (var gi = 0; gi < groups.length; gi++) {
        var gid = str(groups[gi] && groups[gi].id);
        if (gid && groupUnits[gid]) return groupUnits[gid];
      }
      if (distinct.length === 1) return distinct[0];
      return '';
    };
  }

  function harvestFromReview(data, unitId, partUnits, groupUnits) {
    var n = 0;
    if (!isPlainObject(data)) return 0;
    var i;
    var gi;
    var qi;

    var parts = asArray(data.parts);
    for (i = 0; i < parts.length; i++) {
      var p = parts[i] || {};
      var pid = partIdOf(p);
      var uid = str(p.originalUnitId || (partUnits && partUnits[pid]) || unitId || '');
      var groups = asArray(p.groups);
      for (gi = 0; gi < groups.length; gi++) {
        var g = groups[gi] || {};
        var gid = str(g.id);
        var guid = str((groupUnits && groupUnits[gid]) || uid);
        var qs = asArray(g.questions);
        for (qi = 0; qi < qs.length; qi++) {
          var q = qs[qi] || {};
          var ra = q.rightAnswer;
          if (ra === undefined || ra === null || ra === '') ra = q.correctAnswer;
          if (ra === undefined || ra === null || ra === '') continue;
          var qid = questionIdOf(q);
          var qn = qNumberOf(q);
          if (qid) answerCache.byQuestionId[qid] = str(ra);
          if (qn && guid) answerCache.byUnitQ[guid + '::' + qn] = str(ra);
          n++;
        }
      }
    }

    var details = asArray(data.details);
    for (i = 0; i < details.length; i++) {
      var d = details[i] || {};
      var ra2 = d.rightAnswer;
      if (ra2 === undefined || ra2 === null || ra2 === '') ra2 = d.correctAnswer;
      if (ra2 === undefined || ra2 === null || ra2 === '') continue;
      var qid2 = questionIdOf(d);
      var qn2 = str(d.qNumber !== undefined && d.qNumber !== null ? d.qNumber : d.questionNumber);
      var pid2 = str(d.partId);
      var uid2 = str((partUnits && partUnits[pid2]) ||
        (groupUnits && groupUnits[str(d.groupId)]) || unitId || '');
      if (qid2) answerCache.byQuestionId[qid2] = str(ra2);
      if (qn2 && uid2) answerCache.byUnitQ[uid2 + '::' + qn2] = str(ra2);
      n++;
    }

    return n;
  }

  function submitUnitSubset(unitId, channel, subset, comp) {
    var body = {
      unitId: str(unitId),
      channel: normalizeChannel(channel) || str(channel) || 'reading',
      parts: subset
    };
    var url = apiBase() + '/practice/v1/attempts';
    return requestUpstream(url, {
      method: 'POST',
      body: JSON.stringify(body)
    }, UPSTREAM_TIMEOUT_MS).then(function (res) {
      var data = res && res.ok ? res.data : null;
      var resultId = str(data && (data.resultId || data.attemptId));
      return { unitId: str(unitId), ok: !!(res && res.ok && resultId), resultId: resultId, res: res };
    });
  }

  function handleMixedAttempts(ctx) {
    var id = decodeURIComponent(str(ctx.params[0]));
    return readBody(ctx.input, ctx.init).then(function (body) {
      var b = isPlainObject(body) ? body : {};
      var comp = getComposition(id);
      if (!comp) {
        return fail('MIXED_PRACTICE_COMPOSITION_NOT_FOUND', 500);
      }
      var channel = normalizeChannel(b.channel) || normalizeChannel(comp.channel) || 'reading';
      var submitted = asArray(b.parts);

      return ensureCompositionExam(id).then(function (exam) {
        var examParts = exam && isArray(exam.parts) ? exam.parts : [];
        var resolveUnit = buildUnitResolver(comp, examParts);

        // 1. split the submitted parts by their source originalUnitId
        var buckets = {};
        var order = [];
        var unknown = [];
        for (var i = 0; i < submitted.length; i++) {
          var part = submitted[i] || {};
          var uid = resolveUnit(part);
          if (!uid) { unknown.push(part); continue; }
          if (!buckets[uid]) { buckets[uid] = []; order.push(uid); }
          buckets[uid].push(part);
        }

        if (!order.length) {
          return fail('MIXED_PRACTICE_NOT_ENOUGH_PARTS', 500);
        }

        // 2. submit each unit subset sequentially (gentle on the upstream)
        var jobs = [];
        var chain = Promise.resolve();
        for (var oi = 0; oi < order.length; oi++) {
          chain = chain.then((function (uid) {
            return function () {
              return submitUnitSubset(uid, channel, buckets[uid], comp).then(function (r) {
                jobs.push(r);
              }, function () {
                jobs.push({ unitId: uid, ok: false, resultId: '' });
              });
            };
          })(order[oi]));
        }

        return chain.then(function () {
          var unitResultIds = [];
          var failures = [];
          for (var j = 0; j < jobs.length; j++) {
            if (jobs[j].ok && jobs[j].resultId) unitResultIds.push(jobs[j].resultId);
            else failures.push({ unitId: jobs[j].unitId, reason: 'submit_failed' });
          }
          for (var u = 0; u < unknown.length; u++) {
            failures.push({ unitId: '', partId: partIdOf(unknown[u]), reason: 'unknown_unit' });
          }

          if (!unitResultIds.length) {
            return fail('MIXED_PRACTICE_RUNTIME_NOT_READY', 500);
          }

          // 4. harvest rightAnswer for every resultId
          var harvestChain = Promise.resolve();
          var harvested = 0;
          for (var h = 0; h < unitResultIds.length; h++) {
            harvestChain = harvestChain.then((function (rid) {
              return function () {
                var url = apiBase() + '/practice/v1/results/' + encodeURIComponent(rid) + '/review';
                return requestUpstream(url, { method: 'GET' }, UPSTREAM_TIMEOUT_MS)
                  .then(function (res) {
                    if (!res || !res.ok) return;
                    harvested += harvestFromReview(res.data, '', comp.partUnits, comp.groupUnits);
                  }, function () { /* ignore */ });
              };
            })(unitResultIds[h]));
          }

          return harvestChain.then(function () {
            // 5. persist the answer cache
            var saved = saveAnswers();

            // 6. grade the composed paper locally from the harvested answers
            var graded = gradeComposition(examParts, submitted);

            // Mark the source units done so `onlyUndone` can honour them.
            var pu = isPlainObject(comp.partUnits) ? comp.partUnits : {};
            for (var k in pu) {
              if (!has(pu, k)) continue;
              if (pu[k]) composeStore.doneUnits[str(pu[k])] = 1;
            }

            comp.attempt = {
              submittedAt: nowIso(),
              elapsedSeconds: elapsedFromTimer(b.timer, b),
              channel: channel,
              resultId: unitResultIds[0],
              unitResultIds: unitResultIds,
              failures: failures,
              parts: graded.parts,
              details: graded.details,
              total: graded.total,
              correct: graded.correct,
              accuracy: graded.accuracy
            };
            comp.lastAttemptId = unitResultIds[0];
            saveComposeStore();

            if (webCfg.debug) {
              safe(function () {
                console.info('[xxgg-server-compose] graded', {
                  compositionId: id,
                  unitResultIds: unitResultIds.length,
                  harvested: harvested,
                  answersCached: answerCount(),
                  cacheSaved: saved,
                  total: graded.total,
                  correct: graded.correct
                });
              }, null);
            }

            // 7. EXACT response shape the app requires.
            return ok({
              compositionId: id,
              status: 'submitted',
              resultId: unitResultIds[0],
              unitResultIds: unitResultIds
            });
          });
        });
      });
    });
  }

  function elapsedFromTimer(timer, body) {
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

  /* ------------------------------------------------------------------ */
  /* 5. review                                                           */
  /* ------------------------------------------------------------------ */
  function handleMixedReview(ctx) {
    var id = decodeURIComponent(str(ctx.params[0]));
    var comp = getComposition(id);

    if (!comp) {
      return Promise.resolve(ok({
        compositionId: id,
        id: id,
        sessionType: 'mixed',
        title: CN_MIXED_TITLE,
        elapsedSeconds: 0,
        children: [],
        parts: [],
        details: []
      }));
    }

    return ensureCompositionExam(id).then(function (exam) {
      var examParts = exam && isArray(exam.parts) ? exam.parts : [];
      var attempt = isPlainObject(comp.attempt) ? comp.attempt : null;
      var parts = attempt && isArray(attempt.parts) && attempt.parts.length
        ? attempt.parts : examParts;
      var details = attempt && isArray(attempt.details) && attempt.details.length
        ? attempt.details : detailsFromParts(parts);

      // `children` is always populated: one row per composed part.
      var children = [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i] || {};
        children.push({
          slot: str(p.slot || ('P' + (i + 1))),
          partNo: str(p.partNum || p.partNo || ('Part ' + (i + 1))),
          partId: partIdOf(p),
          originalUnitId: str(p.originalUnitId || p.unitId || '')
        });
      }
      if (!children.length) {
        var slots = asArray(comp.slots);
        for (var j = 0; j < slots.length; j++) {
          var s = slots[j] || {};
          children.push({
            slot: str(s.slot || ('P' + (j + 1))),
            partNo: str(s.partNo || ('Part ' + (j + 1))),
            partId: str(s.partId || s.id || ''),
            originalUnitId: str(s.unitId || '')
          });
        }
      }

      return ok({
        compositionId: id,
        id: id,
        sessionType: 'mixed',
        title: CN_MIXED_TITLE,
        unitTitle: CN_MIXED_TITLE,
        elapsedSeconds: attempt ? num(attempt.elapsedSeconds, 0) : 0,
        total: attempt ? num(attempt.total, 0) : 0,
        score: attempt ? num(attempt.correct, 0) : 0,
        accuracy: attempt ? num(attempt.accuracy, 0) : 0,
        children: children,
        parts: parts,
        details: details
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 6. history (dead code upstream)                                     */
  /* ------------------------------------------------------------------ */
  function handleMixedHistory() {
    return Promise.resolve(ok({ list: [], records: [] }));
  }

  /* ------------------------------------------------------------------ */
  /* Route table (matched on pathname suffix, origin independent)        */
  /* ------------------------------------------------------------------ */
  var ROUTES = [
    { name: 'mixed-history', re: /\/practice\/v1\/mixed-practice\/compositions\/history$/, methods: ['GET'] },
    { name: 'mixed-compose', re: /\/practice\/v1\/mixed-practice\/compose$/, methods: ['POST'] },
    { name: 'mixed-exam', re: /\/practice\/v1\/mixed-practice\/compositions\/([^/]+)\/exam$/, methods: ['GET'] },
    { name: 'mixed-attempts', re: /\/practice\/v1\/mixed-practice\/compositions\/([^/]+)\/attempts$/, methods: ['POST'] },
    { name: 'mixed-review', re: /\/practice\/v1\/mixed-practice\/compositions\/([^/]+)\/review$/, methods: ['GET'] },
    { name: 'entitlements', re: /\/practice\/v1\/me\/feature-entitlements$/, methods: ['GET'] }
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

  function dispatch(name, ctx) {
    switch (name) {
      case 'entitlements': return handleEntitlements(ctx);
      case 'mixed-compose': return handleCompose(ctx);
      case 'mixed-exam': return handleMixedExam(ctx);
      case 'mixed-attempts': return handleMixedAttempts(ctx);
      case 'mixed-review': return handleMixedReview(ctx);
      case 'mixed-history': return handleMixedHistory(ctx);
      default: return Promise.resolve(null);
    }
  }

  /* ------------------------------------------------------------------ */
  /* fetch patch                                                         */
  /* ------------------------------------------------------------------ */
  function patchedFetch(input, init) {
    // The module only serves a REAL session. Without one this is a byte-for-byte
    // passthrough, so the module is inert for local mode and for logged-out use.
    if (!hasRealSession()) {
      return nativeFetch(input, init);
    }

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

    if (!route) {
      return nativeFetch(input, init);
    }

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
      .then(function (res) {
        if (res) return res;
        return nativeFetch(input, init);
      }, function () {
        // Never surface a 401 / code 401 to the app.
        return jsonResponse({
          code: '500',
          msg: 'MIXED_PRACTICE_RUNTIME_NOT_READY',
          data: null
        }, 500);
      });
  }

  try {
    W.fetch = patchedFetch;
  } catch (e) {
    publishHandle(false, 'patch-failed');
    return;
  }

  /* ------------------------------------------------------------------ */
  /* Public diagnostics handle                                           */
  /* ------------------------------------------------------------------ */
  function statsSnapshot() {
    var comps = Object.keys(composeStore.compositions);
    var withExam = 0;
    var withAttempt = 0;
    for (var i = 0; i < comps.length; i++) {
      var c = composeStore.compositions[comps[i]];
      if (isPlainObject(c) && isPlainObject(c.exam) && isArray(c.exam.parts) && c.exam.parts.length) withExam++;
      if (isPlainObject(c) && isPlainObject(c.attempt)) withAttempt++;
    }
    return {
      version: MODULE_VERSION,
      enabled: hasRealSession(),
      apiBase: apiBase(),
      realSession: hasRealSession(),
      compositions: comps.length,
      compositionsWithExam: withExam,
      compositionsWithAttempt: withAttempt,
      doneUnits: Object.keys(composeStore.doneUnits).length,
      answersByQuestionId: Object.keys(answerCache.byQuestionId).length,
      answersByUnitQuestion: Object.keys(answerCache.byUnitQ).length,
      answersUpdatedAt: answerCache.updatedAt,
      cacheKeys: { compose: COMPOSE_KEY, answers: ANSWERS_KEY },
      updatedAt: nowIso()
    };
  }

  publishHandle(hasRealSession(), hasRealSession() ? 'ready' : 'no-real-session');

  if (webCfg.debug) {
    safe(function () {
      console.info('[xxgg-server-compose] loaded', {
        apiBase: apiBase(),
        realSession: hasRealSession(),
        store: COMPOSE_KEY,
        answers: ANSWERS_KEY
      });
    }, null);
  }
})();
