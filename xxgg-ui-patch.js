/**
 * xxgg-ui-patch.js
 * UI adjustments for the web build.
 *
 * Hides the rotating rail button whose label cycles through
 * "Plan / Contact / Notice / Feedback"
 * (element class: ielts-rail-plan-link).
 *
 * It is a single button with a rolling label, not four separate buttons,
 * so removing it removes the whole roller.
 */
(function () {
  'use strict';
  var W = window;
  var D = W.document;
  if (!D) return;

  var ID = 'xxgg-ui-patch-css';
  var CSS = [
    '.ielts-rail-plan-link{display:none !important;visibility:hidden !important;pointer-events:none !important;}',
    'button.ielts-rail-plan-link{display:none !important;}',
    '.ielts-rail-nav .ielts-rail-plan-link{display:none !important;}'
  ].join('\n');

  function inject() {
    try {
      if (D.getElementById(ID)) return;
      var st = D.createElement('style');
      st.id = ID;
      st.textContent = CSS;
      (D.head || D.documentElement).appendChild(st);
    } catch (e) { }
  }

  inject();
  D.addEventListener('DOMContentLoaded', inject);
  try {
    setTimeout(inject, 600);
    setTimeout(inject, 2000);
    setTimeout(inject, 5000);
  } catch (e) { }

  /* ------------------------------------------------------------------ */
  /* Brand rename                                                        */
  /* The app bundle renders the old product name from its own minified    */
  /* strings, so patch text nodes (and a few attributes) at runtime and   */
  /* re-apply whenever Vue re-renders.                                    */
  /* ------------------------------------------------------------------ */
  var FROM = '\u4e5d\u5206\u5b66\u957f';
  var TO = '\u7f57\u5b66\u957f';
  var RENAME_ATTRS = ['title', 'aria-label', 'alt', 'placeholder', 'content'];

  function renameIn(el) {
    try {
      if (!el) return;
      if (el.nodeType === 3) {
        if (el.nodeValue && el.nodeValue.indexOf(FROM) !== -1) {
          el.nodeValue = el.nodeValue.split(FROM).join(TO);
        }
        return;
      }
      var walker = D.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue && n.nodeValue.indexOf(FROM) !== -1) {
          n.nodeValue = n.nodeValue.split(FROM).join(TO);
        }
      }
      var all = el.querySelectorAll ? el.querySelectorAll('*') : [];
      for (var i = 0; i < all.length; i++) {
        for (var a = 0; a < RENAME_ATTRS.length; a++) {
          var v = all[i].getAttribute && all[i].getAttribute(RENAME_ATTRS[a]);
          if (v && v.indexOf(FROM) !== -1) {
            all[i].setAttribute(RENAME_ATTRS[a], v.split(FROM).join(TO));
          }
        }
      }
    } catch (e) { }
  }

  function renameTitle() {
    try {
      if (D.title && D.title.indexOf(FROM) !== -1) {
        D.title = D.title.split(FROM).join(TO);
      }
    } catch (e) { }
  }

  function renameAll() {
    renameTitle();
    if (D.body) renameIn(D.body);
  }

  var renameTimer = null;
  function scheduleRename() {
    if (renameTimer) return;
    renameTimer = setTimeout(function () { renameTimer = null; renameAll(); }, 200);
  }

  renameAll();
  D.addEventListener('DOMContentLoaded', renameAll);
  try {
    setTimeout(renameAll, 400);
    setTimeout(renameAll, 1200);
    setTimeout(renameAll, 3000);
  } catch (e) { }

  try {
    if (W.MutationObserver) {
      new W.MutationObserver(scheduleRename).observe(D.documentElement, {
        childList: true, subtree: true, characterData: true
      });
    }
  } catch (e) { }

  /* ------------------------------------------------------------------ */
  /* Touch support for the pane resizer bars                             */
  /*                                                                     */
  /* The layout wires mousedown on the resizer and then tracks            */
  /* document-level mousemove / mouseup. Touch never produces those, so   */
  /* the bars are simply not draggable on a tablet. Replay the mouse      */
  /* sequence from touch events and widen the grab area in JS so that no  */
  /* CSS layout is disturbed.                                             */
  /* ------------------------------------------------------------------ */
  var RESIZER_SEL = '.ielts-sb-resizer, .ielts-sb-resizer-grip, [class*="resizer"]';
  var GRAB_SLOP = 22;
  var dragging = false;

  function dragCss() {
    try {
      if (D.getElementById('xxgg-drag-css')) return;
      var st = D.createElement('style');
      st.id = 'xxgg-drag-css';
      st.textContent = RESIZER_SEL + '{touch-action:none !important;}';
      (D.head || D.documentElement).appendChild(st);
    } catch (e) { }
  }

  function pointFrom(e) {
    var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || null;
    return t ? { x: t.clientX, y: t.clientY } : null;
  }

  function fireMouse(type, x, y, target) {
    var buttons = (type === 'mouseup') ? 0 : 1;
    try {
      var ev = new MouseEvent(type, {
        bubbles: true, cancelable: true, view: W,
        clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: buttons
      });
      (target || D).dispatchEvent(ev);
      return true;
    } catch (e) {
      try {
        var ev2 = D.createEvent('MouseEvents');
        ev2.initMouseEvent(type, true, true, W, 0, x, y, x, y,
          false, false, false, false, 0, null);
        (target || D).dispatchEvent(ev2);
        return true;
      } catch (e2) { return false; }
    }
  }

  // Naked bars are only a few px wide, so also accept a near miss.
  function nearestResizer(x, y) {
    try {
      var list = D.querySelectorAll(RESIZER_SEL);
      var best = null;
      var bestD = GRAB_SLOP;
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect();
        if (!r.width && !r.height) continue;
        var vertical = r.height >= r.width;
        var d;
        if (vertical) {
          if (y < r.top - 10 || y > r.bottom + 10) continue;
          d = Math.abs(x - (r.left + r.width / 2));
        } else {
          if (x < r.left - 10 || x > r.right + 10) continue;
          d = Math.abs(y - (r.top + r.height / 2));
        }
        if (d <= bestD) { bestD = d; best = list[i]; }
      }
      return best;
    } catch (e) { return null; }
  }

  D.addEventListener('touchstart', function (e) {
    try {
      var p = pointFrom(e);
      if (!p) return;
      var tgt = e.target;
      var handle = null;
      if (tgt && typeof tgt.closest === 'function') handle = tgt.closest(RESIZER_SEL);
      if (!handle) handle = nearestResizer(p.x, p.y);
      if (!handle) return;
      dragging = true;
      fireMouse('mousedown', p.x, p.y, handle);
      try { e.preventDefault(); } catch (err) { }
    } catch (err) { }
  }, { passive: false, capture: true });

  D.addEventListener('touchmove', function (e) {
    if (!dragging) return;
    try {
      var p = pointFrom(e);
      if (!p) return;
      fireMouse('mousemove', p.x, p.y, D);
      e.preventDefault();
    } catch (err) { }
  }, { passive: false, capture: true });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    try {
      var p = pointFrom(e) || { x: 0, y: 0 };
      fireMouse('mouseup', p.x, p.y, D);
    } catch (err) { }
  }
  D.addEventListener('touchend', endDrag, true);
  D.addEventListener('touchcancel', endDrag, true);

  dragCss();
  D.addEventListener('DOMContentLoaded', dragCss);

  /* ------------------------------------------------------------------ */
  /* Count-up clock for the untimed exam mode                            */
  /*                                                                     */
  /* Untimed papers show a static placeholder in the header instead of a  */
  /* countdown. Watch .exam-header__time-remaining; once its text looks   */
  /* untimed (or has simply not changed for several seconds) start a      */
  /* stopwatch from 0 and keep writing MM:SS into it.                     */
  /* ------------------------------------------------------------------ */
  var CU_SLOT = '.exam-header__time-remaining';
  var CU_UNTIMED = /(\u4e0d\u9650|\u4e0d\u8ba1\u65f6|--|\u2014|^\s*$)/;
  var CU_STATIC_TICKS = 6;
  var cuActive = false;
  var cuStatic = 0;
  var cuLast = '';
  var cuStartAt = 0;

  function cuKey() {
    try { return 'xxgg.stopwatch.' + (W.location ? W.location.pathname : 'exam'); }
    catch (e) { return 'xxgg.stopwatch'; }
  }

  function cuTarget() {
    try {
      var box = D.querySelector(CU_SLOT);
      if (!box) return null;
      return box.querySelector('span') || box;
    } catch (e) { return null; }
  }

  function cuPad(n) { return (n < 10 ? '0' : '') + n; }

  function cuFormat(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return h > 0 ? (h + ':' + cuPad(m) + ':' + cuPad(s)) : (cuPad(m) + ':' + cuPad(s));
  }

  function cuTick() {
    try {
      var el = cuTarget();
      if (!el) {
        // left the exam page
        cuActive = false; cuStatic = 0; cuLast = '';
        return;
      }

      if (!cuActive) {
        var txt = String(el.textContent || '').trim();
        if (txt === cuLast) cuStatic++;
        else { cuStatic = 0; cuLast = txt; }

        if (CU_UNTIMED.test(txt) || cuStatic >= CU_STATIC_TICKS) {
          cuActive = true;
          var saved = null;
          try { saved = W.sessionStorage ? W.sessionStorage.getItem(cuKey()) : null; } catch (e) { saved = null; }
          cuStartAt = saved ? Number(saved) : Date.now();
          if (!saved) {
            try { if (W.sessionStorage) W.sessionStorage.setItem(cuKey(), String(cuStartAt)); } catch (e) { }
          }
          if (!cuStartAt || !isFinite(cuStartAt)) cuStartAt = Date.now();
        }
        return;
      }

      var sec = Math.max(0, Math.floor((Date.now() - cuStartAt) / 1000));
      el.textContent = cuFormat(sec);
    } catch (e) { }
  }

  try { setInterval(cuTick, 1000); } catch (e) { }
  try { setTimeout(cuTick, 800); } catch (e) { }

  W.__xxggUiPatch = { hidden: ['ielts-rail-plan-link'] };
})();
