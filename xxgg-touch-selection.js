/**
 * xxgg-touch-selection.js
 * ---------------------------------------------------------------------------
 * Touch adaptation for the highlight + annotation popup.
 *
 * Trigger model
 *   DOUBLE TAP selects a word and opens the popup, matching the desktop
 *   drag-release feel. Long-press is not used (iOS hijacks it for its own
 *   callout menu).
 *
 * Why we build the selection ourselves
 *   The reading areas carry `touch-action: manipulation` so a double tap does
 *   not zoom the page. The side effect is that iOS then also refuses to perform
 *   its native double-tap word selection - `window.getSelection()` stays empty
 *   and the app's mouseup handler bails out. So instead of relying on the
 *   system, we resolve the tapped position with `caretRangeFromPoint`, expand it
 *   to word boundaries, install that Range into the selection, and only then
 *   replay `mouseup` for the app.
 *
 * Diagnostics
 *   Open the site with ?touchdebug=1 and a panel appears at the bottom logging
 *   every step. Use its Copy button to send the log back.
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
  var touchEndCount = 0;

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
    if (logs.length > 140) logs.shift();
    if (DEBUG) renderPanel();
    try { if (W.console) W.console.log('[touch] ' + msg); } catch (e) { /* noop */ }
  }

  function ensurePanel() {
    if (!DEBUG || panel) return;
    try {
      panel = D.createElement('div');
      panel.id = 'xxgg-touch-debug';
      panel.setAttribute('style', [
        'position:fixed', 'left:0', 'right:0', 'bottom:0', 'max-height:44vh',
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

  function caretRangeAt(x, y) {
    try {
      if (typeof D.caretRangeFromPoint === 'function') {
        var r = D.caretRangeFromPoint(x, y);
        if (r) return r;
      }
    } catch (e) { /* noop */ }
    try {
      if (typeof D.caretPositionFromPoint === 'function') {
        var pos = D.caretPositionFromPoint(x, y);
        if (pos && pos.offsetNode) {
          var r2 = D.createRange();
          r2.setStart(pos.offsetNode, pos.offset);
          r2.collapse(true);
          return r2;
        }
      }
    } catch (e) { /* noop */ }
    return null;
  }

  var WORD_CHAR = /[A-Za-z0-9\u00c0-\u024f'\u2019-]/;

  function textNodeAt(node, offset, forward) {
    try {
      if (node && node.nodeType === 3) return node;
      var el = node;
      if (!el) return null;
      var walker = D.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var n = walker.nextNode();
      if (n) return n;
      if (forward) {
        var p = el.parentElement;
        while (p) {
          var w2 = D.createTreeWalker(p, NodeFilter.SHOW_TEXT, null);
          var m = w2.nextNode();
          if (m) return m;
          p = p.parentElement;
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Build a word Range around the tapped position.
  function wordRangeAt(x, y) {
    var base = caretRangeAt(x, y);
    if (!base) return null;

    var node = base.startContainer;
    var offset = base.startOffset;

    node = textNodeAt(node, offset, true);
    if (!node || node.nodeType !== 3) return null;

    var text = node.textContent || '';
    if (!text) return null;

    if (typeof offset !== 'number' || offset < 0 || offset > text.length) {
      offset = Math.min(1, text.length);
    }

    var s = offset;
    var e = offset;
    while (s > 0 && WORD_CHAR.test(text.charAt(s - 1))) s--;
    while (e < text.length && WORD_CHAR.test(text.charAt(e))) e++;

    if (s === e) return null;

    try {
      var r = D.createRange();
      r.setStart(node, s);
      r.setEnd(node, e);
      return r;
    } catch (err) {
      return null;
    }
  }

  function installSelection(range) {
    try {
      var sel = W.getSelection();
      if (!sel) return false;
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
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

  function dispatchMouseUp(el, x, y) {
    try {
      var ev = new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: W,
        clientX: x, clientY: y, screenX: x, screenY: y
      });
      el.dispatchEvent(ev);
      return 'MouseEvent';
    } catch (e) {
      try {
        var ev2 = D.createEvent('MouseEvents');
        ev2.initMouseEvent('mouseup', true, true, W, 0, x, y, x, y,
          false, false, false, false, 0, null);
        el.dispatchEvent(ev2);
        return 'legacy';
      } catch (e2) {
        return 'failed:' + (e2 && e2.message);
      }
    }
  }

  function fire(tag) {
    var sel = currentSelection();
    var built = 'native';

    // iOS refuses native double-tap selection while touch-action:manipulation
    // is in force, so fall back to building the word selection ourselves.
    if (!sel) {
      var r = wordRangeAt(lastTapX, lastTapY);
      if (r) {
        if (installSelection(r)) {
          built = 'built';
          sel = currentSelection();
        } else {
          built = 'build-install-failed';
        }
      } else {
        built = 'build-failed';
      }
    }

    if (!sel) {
      log('fire(' + tag + ') -> no usable selection (source=' + built + ')');
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

    log('fire(' + tag + ') source=' + built + ' text="' + sel.text.slice(0, 24) +
      '" len=' + sel.text.length +
      ' anchor=' + (el ? el.tagName + '.' + String(el.className || '').split(' ')[0] : 'null') +
      ' inTextArea=' + textAreaOk + ' inMainContent=' + inMain);

    if (!textAreaOk) return;

    var rect = null;
    try { rect = sel.range.getBoundingClientRect(); } catch (e) { rect = null; }

    var key = sel.text + '|' + (rect ? Math.round(rect.left) + ',' + Math.round(rect.top) : '');
    if (key === lastKey) {
      log('fire(' + tag + ') -> deduped');
      return;
    }
    lastKey = key;

    var x = rect ? Math.round(rect.left + rect.width / 2) : lastTapX;
    var y = rect ? Math.round(rect.bottom) : lastTapY;

    var how = dispatchMouseUp(el, x, y);
    log('dispatched=' + how + ' at ' + x + ',' + y);

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
  D.addEventListener('touchend', function (e) {
    touchEndCount++;
    var p = touchPoint(e);
    var now = Date.now();
    var dt = now - lastTapAt;
    var isDouble = (lastTapAt > 0) && dt <= DOUBLE_TAP_MS &&
                   Math.abs(p.x - lastTapX) <= DOUBLE_TAP_PX &&
                   Math.abs(p.y - lastTapY) <= DOUBLE_TAP_PX;

    log('touchend#' + touchEndCount + ' at ' + Math.round(p.x) + ',' + Math.round(p.y) +
      ' dt=' + (lastTapAt ? dt : -1) + ' double=' + isDouble);

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
  /* Styling: keep double-tap zoom off (we build the selection ourselves) */
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
    wordRangeAt: wordRangeAt,
    logs: function () { return logs.slice(); }
  };

  log('module ready isTouch=' + isTouch + ' debug=' + DEBUG +
      ' caretRangeFromPoint=' + (typeof D.caretRangeFromPoint) +
      ' caretPositionFromPoint=' + (typeof D.caretPositionFromPoint));
  log('UA=' + String(W.navigator && W.navigator.userAgent || '').slice(0, 110));
})();
