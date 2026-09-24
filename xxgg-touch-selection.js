/**
 * xxgg-touch-selection.js
 * ---------------------------------------------------------------------------
 * Touch / mobile adaptation for the highlight + annotation feature.
 *
 * Problem
 *   The app only wires mouse events for text selection:
 *       document.addEventListener("mouseup", Lt)
 *       document.addEventListener("selectionchange", Dt)
 *       document.addEventListener("click", Pt)
 *   There is no touchstart / touchend anywhere in the bundle, so on phones and
 *   tablets the popup that lets you highlight or annotate never opens.
 *
 * Trigger model (deliberate)
 *   DOUBLE TAP selects a word and opens the popup - matching the desktop
 *   drag-release feel. Long-press is intentionally NOT used: iOS hijacks
 *   long-press for its own callout menu, which fights with the popup.
 *   After the double tap the user can still drag the selection handles; the
 *   popup refreshes then too.
 *
 * Safety
 *   - Activates only on touch-capable devices.
 *   - Only fires when a non-collapsed selection exists inside a reading area,
 *     so ordinary single taps never open anything.
 *   - De-duplicates by selection text + position.
 *   - Wrapped in try/catch everywhere; never throws into the app.
 */
(function () {
  'use strict';

  var W = window;
  var D = W.document;
  if (!D) return;

  var isTouch = ('ontouchstart' in W) || (W.navigator && W.navigator.maxTouchPoints > 0);
  if (!isTouch) return;

  var SEL_POPUP = '.selection-popup';
  var TEXT_AREAS = '.main-content, .text-panel, .passage, .article, [class*="text-body"], [class*="reading"], [class*="article-body"]';

  var DOUBLE_TAP_MS = 340;
  var DOUBLE_TAP_PX = 40;

  var lastTapAt = 0;
  var lastTapX = 0;
  var lastTapY = 0;
  var armed = false;
  var lastKey = '';
  var timer = null;

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

  function fire() {
    var cur = currentSelection();
    if (!cur) {
      armed = false;
      lastKey = '';
      return;
    }

    var el = anchorElement(cur.range);
    if (!inTextArea(el)) return;

    var rect = null;
    try { rect = cur.range.getBoundingClientRect(); } catch (e) { rect = null; }

    var key = cur.text + '|' + (rect ? Math.round(rect.left) + ',' + Math.round(rect.top) : '');
    if (key === lastKey) return;
    lastKey = key;

    var x = rect ? Math.round(rect.left + rect.width / 2) : 0;
    var y = rect ? Math.round(rect.bottom) : 0;

    try {
      var ev = new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, view: W,
        clientX: x, clientY: y, screenX: x, screenY: y
      });
      el.dispatchEvent(ev);
    } catch (e) {
      try {
        var ev2 = D.createEvent('MouseEvents');
        ev2.initMouseEvent('mouseup', true, true, W, 0, x, y, x, y,
          false, false, false, false, 0, null);
        el.dispatchEvent(ev2);
      } catch (e2) { /* give up quietly */ }
    }
  }

  function schedule(delay) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, delay);
  }

  function touchPoint(e) {
    var t = (e.changedTouches && e.changedTouches[0]) || null;
    return t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Double-tap detection                                                */
  /* ------------------------------------------------------------------ */
  D.addEventListener('touchend', function (e) {
    var p = touchPoint(e);
    var now = Date.now();
    var isDouble = (now - lastTapAt) <= DOUBLE_TAP_MS &&
                   Math.abs(p.x - lastTapX) <= DOUBLE_TAP_PX &&
                   Math.abs(p.y - lastTapY) <= DOUBLE_TAP_PX;

    lastTapAt = now;
    lastTapX = p.x;
    lastTapY = p.y;

    if (!isDouble) return;

    armed = true;
    // The browser performs native word selection asynchronously, so try a few
    // times rather than guessing a single delay.
    schedule(60);
    setTimeout(function () { if (armed) fire(); }, 220);
    setTimeout(function () { if (armed) fire(); }, 430);
  }, true);

  // After a double tap the user may drag the selection handles - keep the
  // popup in sync. Not armed => this stays silent, so long-press alone does
  // not open anything.
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
        // Disable double-tap zoom on reading areas so double tap = select word.
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

  // Diagnostics / manual trigger from a test page.
  W.__xxggTouchSelection = {
    enabled: true,
    trigger: 'double-tap',
    fire: fire,
    schedule: schedule
  };
})();
