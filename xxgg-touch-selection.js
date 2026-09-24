/**
 * xxgg-touch-selection.js
 * ---------------------------------------------------------------------------
 * Touch adaptation for the highlight + annotation popup, with built-in
 * on-screen diagnostics.
 *
 * Trigger model
 *   DOUBLE TAP selects a word and opens the popup, matching the desktop
 *   drag-release feel. Long-press is intentionally NOT used because iOS
 *   hijacks it for its own callout menu.
 *
 * Diagnostics
 *   Open the site with ?touchdebug=1 (or set localStorage xxgg.touchDebug=1)
 *   and a panel appears at the bottom logging every step:
 *     - whether touch was detected
 *     - each touchend and whether a double tap was recognised
 *     - at fire time: does a selection exist, is it collapsed, its text,
 *       and is its ancestor inside .main-content
 *     - after dispatch: does .selection-popup exist in the DOM, and what are
 *       its computed display / visibility / opacity / z-index / position
 *   There is a Copy button so the log can be pasted back for analysis.
 */
(function () {
  'use strict';

  var W = window;
  var D = W.document;
  if (!D) return;

  var isTouch = ('ontouchstart' in W) || (W.navigator && W.navigator.maxTouchPoints > 0);
  if (!isTouch) return;

  var SEL_POPUP = '.selection-popup';
  var MAIN = '.main-content';
  var TEXT_AREAS = '.main-content, .text-panel, .passage, .article, [class*="text-body"], [class*="reading"], [class*="article-body"]';

  var DOUBLE_TAP_MS = 340;
  var DOUBLE_TAP_PX = 40;

  var lastTapAt = 0;
  var lastTapX = 0;
  var lastTapY = 0;
  var armed = false;
  var lastKey = '';
  var timer = null;

  /* ------------------------------------------------------------------ */
  /* Diagnostics                                                         */
  /* ------------------------------------------------------------------ */
  var logs = [];
  var panel = null;
  var logBox = null;

  function debugOn() {
    try {
      if (/[?&#]touchdebug/.test(String(W.location.href))) return true;
      if (W.localStorage && W.localStorage.getItem('xxgg.touchDebug') === '1') return true;
    } catch (e) { /* noop */ }
    return false;
  }

  var DEBUG = debugOn();

  function log(msg) {
    var line = (new Date().toISOString().slice(11, 23)) + '  ' + msg;
    logs.push(line);
    if (logs.length > 120) logs.shift();
    if (DEBUG) renderPanel();
    try { if (W.console) W.console.log('[touch] ' + msg); } catch (e) { /* noop */ }
  }

  function ensurePanel() {
    if (!DEBUG || panel) return;
    try {
      panel = D.createElement('div');
      panel.id = 'xxgg-touch-debug';
      panel.setAttribute('style', [
        'position:fixed', 'left:0', 'right:0', 'bottom:0', 'max-height:46vh',
        'overflow:auto', 'z-index:2147483647', 'background:rgba(12,12,14,.94)',
        'color:#e8e8ea', 'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace',
        'padding:8px 10px 10px', 'white-space:pre-wrap', 'word-break:break-word',
        '-webkit-user-select:text', 'user-select:text'
      ].join(';'));

      var bar = D.createElement('div');
      bar.setAttribute('style', 'display:flex;gap:8px;align-items:center;margin-bottom:6px');

      var title = D.createElement('strong');
      title.textContent = 'touch debug';
      bar.appendChild(title);

      var copyBtn = D.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.setAttribute('style', 'min-height:34px;padding:6px 12px;border-radius:6px;border:1px solid #555;background:#222;color:#eee;font-size:12px');
      copyBtn.onclick = function () {
        try {
          var ta = D.createElement('textarea');
          ta.value = logs.join('\n');
          ta.setAttribute('style', 'position:fixed;left:-9999px');
          D.body.appendChild(ta);
          ta.select();
          D.execCommand('copy');
          D.body.removeChild(ta);
          copyBtn.textContent = 'Copied';
          setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
        } catch (e) { copyBtn.textContent = 'Copy failed'; }
      };
      bar.appendChild(copyBtn);

      var clearBtn = D.createElement('button');
      clearBtn.textContent = 'Clear';
      clearBtn.setAttribute('style', 'min-height:34px;padding:6px 12px;border-radius:6px;border:1px solid #555;background:#222;color:#eee;font-size:12px');
      clearBtn.onclick = function () { logs.length = 0; renderPanel(); };
      bar.appendChild(clearBtn);

      panel.appendChild(bar);

      logBox = D.createElement('div');
      panel.appendChild(logBox);

      (D.body || D.documentElement).appendChild(panel);
    } catch (e) { /* noop */ }
  }

  function renderPanel() {
    try {
      ensurePanel();
      if (logBox) logBox.textContent = logs.slice(-60).join('\n');
      if (panel) panel.scrollTop = panel.scrollHeight;
    } catch (e) { /* noop */ }
  }

  /* ------------------------------------------------------------------ */
  /* Selection helpers                                                   */
  /* ------------------------------------------------------------------ */
  function currentSelection() {
    try {
      var sel = W.getSelection ? W.getSelection() : null;
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      var text = String(sel.toString() || '').trim();
      if (!text) return null;
      return { text: text, range: sel.getRangeAt(0) };
    } catch (e) {
      return null;
    }
  }

  function anchorElement(range) {
    try {
      var n = range.startContainer;
      if (!n) return null;
      var el = n.nodeType === 3 ? n.parentElement : n;
      return el || null;
    } catch (e) {
      return null;
    }
  }

  function inTextArea(el) {
    try {
      if (!el || typeof el.closest !== 'function') return false;
      if (el.closest(SEL_POPUP)) return false;
      return !!el.closest(TEXT_AREAS);
    } catch (e) {
      return false;
    }
  }

  function popupReport() {
    try {
      var p = D.querySelector(SEL_POPUP);
      if (!p) return 'popup=ABSENT';
      var cs = W.getComputedStyle(p);
      var r = p.getBoundingClientRect();
      return 'popup=present display=' + cs.display + ' vis=' + cs.visibility +
        ' op=' + cs.opacity + ' z=' + cs.zIndex +
        ' rect=' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + 'x' + Math.round(r.height);
    } catch (e) {
      return 'popup=ERR ' + (e && e.message);
    }
  }

  function fire(tag) {
    var sel = currentSelection();
    if (!sel) {
      log('fire(' + tag + ') -> no usable selection');
      armed = false;
      lastKey = '';
      return;
    }

    var el = anchorElement(sel.range);
    var textAreaOk = inTextArea(el);

    var inMain = 'n/a';
    try {
      var main = D.querySelector(MAIN);
      var n = sel.range.commonAncestorContainer;
      inMain = main ? String(main.contains(n)) : 'no-main-content';
    } catch (e) { inMain = 'err'; }

    log('fire(' + tag + ') text="' + sel.text.slice(0, 24) + '" len=' + sel.text.length +
      ' anchor=' + (el ? el.tagName + '.' + String(el.className || '').split(' ')[0] : 'null') +
      ' inTextArea=' + textAreaOk + ' inMainContent=' + inMain);

    if (!textAreaOk) return;

    var rect = null;
    try { rect = sel.range.getBoundingClientRect(); } catch (e) { rect = null; }

    var key = sel.text + '|' + (rect ? Math.round(rect.left) + ',' + Math.round(rect.top) : '');
    if (key === lastKey) {
      log('fire(' + tag + ') -> deduped (unchanged selection)');
      return;
    }
    lastKey = key;

    var x = rect ? Math.round(rect.left + rect.width / 2) : 0;
    var y = rect ? Math.round(rect.bottom) : 0;

    var dispatched = 'no';
    try {
      var ev = new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: W,
        clientX: x, clientY: y, screenX: x, screenY: y
      });
      el.dispatchEvent(ev);
      dispatched = 'MouseEvent';
    } catch (e) {
      log('MouseEvent failed: ' + (e && e.message));
      try {
        var ev2 = D.createEvent('MouseEvents');
        ev2.initMouseEvent('mouseup', true, true, W, 0, x, y, x, y,
          false, false, false, false, 0, null);
        el.dispatchEvent(ev2);
        dispatched = 'legacy';
      } catch (e2) {
        log('legacy dispatch failed: ' + (e2 && e2.message));
      }
    }

    log('dispatched=' + dispatched + ' at ' + x + ',' + y);

    setTimeout(function () { log('after 60ms  ' + popupReport()); }, 60);
    setTimeout(function () { log('after 300ms ' + popupReport()); }, 300);
  }

  function schedule(delay) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { fire('scheduled'); }, delay);
  }

  function touchPoint(e) {
    var t = (e.changedTouches && e.changedTouches[0]) || null;
    return t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Double-tap detection                                                */
  /* ------------------------------------------------------------------ */
  var touchEndCount = 0;

  D.addEventListener('touchend', function (e) {
    touchEndCount++;
    var p = touchPoint(e);
    var now = Date.now();
    var dt = now - lastTapAt;
    var isDouble = (lastTapAt > 0) && dt <= DOUBLE_TAP_MS &&
                   Math.abs(p.x - lastTapX) <= DOUBLE_TAP_PX &&
                   Math.abs(p.y - lastTapY) <= DOUBLE_TAP_PX;

    log('touchend#' + touchEndCount + ' at ' + p.x + ',' + p.y + ' dt=' + (lastTapAt ? dt : -1) + ' double=' + isDouble);

    lastTapAt = now;
    lastTapX = p.x;
    lastTapY = p.y;

    if (!isDouble) return;

    armed = true;
    log('DOUBLE TAP armed');
    schedule(60);
    setTimeout(function () { if (armed) fire('t+220'); }, 220);
    setTimeout(function () { if (armed) fire('t+430'); }, 430);
  }, true);

  D.addEventListener('selectionchange', function () {
    if (!armed) return;
    schedule(400);
  });

  /* ------------------------------------------------------------------ */
  /* Touch-friendly styling + disable double-tap zoom                    */
  /* ------------------------------------------------------------------ */
  function injectCss() {
    try {
      if (D.getElementById('xxgg-touch-css')) return;
      var st = D.createElement('style');
      st.id = 'xxgg-touch-css';
      st.textContent = [
        TEXT_AREAS + '{touch-action:manipulation !important;}',
        SEL_POPUP + '{z-index:2147483000 !important;max-width:calc(100vw - 20px) !important;}',
        SEL_POPUP + ' button,' + SEL_POPUP + ' [role="button"],' + SEL_POPUP + ' .selection-action{',
        '  min-height:44px !important;min-width:44px !important;font-size:15px !important;',
        '  padding:10px 14px !important;touch-action:manipulation !important;}',
        '.text-highlight,.note-highlight{cursor:pointer;-webkit-tap-highlight-color:transparent;}'
      ].join('\n');
      (D.head || D.documentElement).appendChild(st);
    } catch (e) { /* noop */ }
  }

  injectCss();
  D.addEventListener('DOMContentLoaded', injectCss);

  W.__xxggTouchSelection = {
    enabled: true,
    trigger: 'double-tap',
    debug: DEBUG,
    fire: fire,
    schedule: schedule,
    logs: function () { return logs.slice(); }
  };

  log('module ready isTouch=' + isTouch + ' debug=' + DEBUG +
      ' maxTouchPoints=' + (W.navigator ? W.navigator.maxTouchPoints : '?') +
      ' touch-action=manipulation');
  log('UA=' + String(W.navigator && W.navigator.userAgent || '').slice(0, 120));
})();
