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
 *   There is no touchstart / touchend anywhere in the bundle. On phones and
 *   tablets a long-press text selection does not reliably produce the `mouseup`
 *   that opens the highlight popup, so highlighting effectively only works
 *   with a mouse cursor.
 *
 * What this does
 *   1. After a touch selection settles (touchend, or a debounced
 *      selectionchange while dragging the selection handles), it replays a
 *      synthetic `mouseup` on the element that owns the selection, so the app's
 *      existing handler runs and shows the popup.
 *   2. Makes the popup touch-friendly: larger tap targets, higher z-index so
 *      it is not buried under the page, and constrained to the viewport width.
 *
 * Safety
 *   - Activates only on touch-capable devices.
 *   - Only fires when the selection is non-collapsed and lives inside a reading
 *     text area, so ordinary taps never open the popup.
 *   - De-duplicates by selection text + position, so it never spams the app.
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
    if (!cur) { lastKey = ''; return; }

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

  // touchend fires before the browser's synthesized click; waiting past it
  // avoids the app's click handler immediately closing the popup again.
  D.addEventListener('touchend', function () { schedule(320); }, true);
  D.addEventListener('selectionchange', function () { schedule(420); });

  /* ------------------------------------------------------------------ */
  /* Touch-friendly popup styling                                        */
  /* ------------------------------------------------------------------ */
  function injectCss() {
    try {
      if (D.getElementById('xxgg-touch-css')) return;
      var st = D.createElement('style');
      st.id = 'xxgg-touch-css';
      st.textContent = [
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

  // Expose for diagnostics / manual trigger from a test page.
  W.__xxggTouchSelection = {
    enabled: true,
    fire: fire,
    schedule: schedule
  };
})();
