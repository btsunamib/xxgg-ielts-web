/**
 * xxgg-touch-selection.js
 * ---------------------------------------------------------------------------
 * Touch adaptation for the highlight + annotation popup.
 *
 * Trigger model
 *   DOUBLE TAP selects a word and opens the popup. Long-press is not used
 *   (iOS hijacks it for its own callout menu).
 *
 * One-shot semantics (important)
 *   A double tap arms exactly ONE fire. Once the popup has been triggered the
 *   arming is cleared immediately, so a later tap elsewhere is left alone and
 *   the app's own outside-click handler can close the popup. Earlier revisions
 *   kept the flag set and re-fired on every selectionchange, which made a
 *   dismiss tap rebuild the selection at the new position instead of closing.
 *
 * Why the selection is built manually
 *   Reading areas carry `touch-action: manipulation` so double tap does not
 *   zoom. That also stops iOS from performing its native double-tap word
 *   selection, so we resolve the tapped point with caretRangeFromPoint,
 *   expand to word boundaries, install that Range, then replay `mouseup`.
 *
 * Diagnostics
 *   Open with ?touchdebug=1 for the on-screen log panel.
 */
(function () {
  'use strict';

  var W = window;
  var D = W.document;
  if (!D) return;

  /* ------------------------------------------------------------------ */
  /* Keyboard: press Tab TWICE to move to the next blank                 */
  /*                                                                     */
  /* Deliberately does NOT depend on any container class name - an earlier */
  /* revision required .main-content and silently let the browser move    */
  /* focus out of the exam when the input lived elsewhere, which made Tab  */
  /* useless. Here we always swallow the key while an editable field is    */
  /* focused, so focus can never escape the paper.                         */
  /* ------------------------------------------------------------------ */
  var TAB_DOUBLE_MS = 700;
  var tabPressAt = 0;

  function kbLog(msg) {
    try { if (typeof log === 'function' && logs) log(msg); } catch (e) { }
  }

  function kbEditable(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    return el.isContentEditable === true;
  }

  function kbFields() {
    try {
      var all = D.querySelectorAll('input, textarea, [contenteditable="true"]');
      var list = [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.disabled || el.readOnly) continue;
        if (el.tagName === 'INPUT') {
          var ty = String(el.type || 'text').toLowerCase();
          if (ty === 'hidden' || ty === 'checkbox' || ty === 'radio' ||
              ty === 'button' || ty === 'submit' || ty === 'reset' ||
              ty === 'file' || ty === 'range' || ty === 'color') continue;
        }
        var r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;         // not visible
        if (el.offsetParent === null && !el.isContentEditable) {
          var cs = null;
          try { cs = W.getComputedStyle(el); } catch (e) { cs = null; }
          if (!cs || cs.position !== 'fixed') continue;     // not rendered
        }
        list.push(el);
      }
      return list;
    } catch (e) { return []; }
  }

  function kbMove(dir) {
    try {
      var list = kbFields();
      if (!list.length) return false;
      var idx = list.indexOf(D.activeElement);
      var next;
      if (idx < 0) next = dir > 0 ? list[0] : list[list.length - 1];
      else next = list[idx + dir];
      if (!next) return false;
      try { next.focus(); } catch (e) { }
      try { if (next.select && next.tagName === 'INPUT') next.select(); } catch (e) { }
      try {
        if (next.scrollIntoView) next.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (e) { }
      return true;
    } catch (e) { return false; }
  }

  function kbFlash(el) {
    try {
      if (!el || !el.style) return;
      var prev = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 3px rgba(64,140,255,.85)';
      setTimeout(function () {
        try { el.style.boxShadow = prev || ''; } catch (e) { }
      }, TAB_DOUBLE_MS);
    } catch (e) { }
  }

  var lastTabAt = 0;

  function onTabKey(e) {
    try {
      var isTab = (e.key === 'Tab') || (e.keyCode === 9) || (e.which === 9);
      if (!isTab) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      var now = Date.now();
      // keydown / keyup / keypress for the SAME press arrive within a few ms.
      if (now - lastTabAt < 60) return;
      lastTabAt = now;

      var a = D.activeElement;
      kbLog('Tab ' + e.type + ' active=' + (a ? a.tagName : 'none') + ' editable=' + kbEditable(a));
      if (!kbEditable(a)) return;

      e.preventDefault();
      e.stopPropagation();

      if (tabPressAt && (now - tabPressAt) <= TAB_DOUBLE_MS) {
        tabPressAt = 0;
        var moved = kbMove(e.shiftKey ? -1 : 1);
        kbLog('Tab x2 -> ' + (moved ? 'moved' : 'no next blank'));
      } else {
        tabPressAt = now;
        kbFlash(a);
        kbLog('Tab #1 armed - press Tab again to move');
      }
    } catch (err) { }
  }

  // Some iPadOS builds only surface one of these, so listen to all three.
  D.addEventListener('keydown', onTabKey, true);
  D.addEventListener('keyup', onTabKey, true);
  D.addEventListener('keypress', onTabKey, true);

  // iPadOS sometimes routes Tab through the system focus engine before the
  // document sees it. Window capture runs earliest, so listen there too.
  try {
    W.addEventListener('keydown', onTabKey, true);
    W.addEventListener('keyup', onTabKey, true);
    W.addEventListener('keypress', onTabKey, true);
  } catch (e) { }

  // Also catch the character-level fallback: some keyboards report Tab as a
  // control character in beforeinput / input.
  try {
    D.addEventListener('beforeinput', function (e) {
      try {
        var d = e && e.data;
        if (d === '\t') { kbLog('beforeinput tab'); onTabKey({ key: 'Tab', keyCode: 9, preventDefault: function () { e.preventDefault(); }, stopPropagation: function () { } }); }
      } catch (e2) { }
    }, true);
  } catch (e) { }


  /* ------------------------------------------------------------------ */
  /* Safety net                                                          */
  /* If the system focus engine steals Tab and pushes focus out of the   */
  /* blanks onto a toolbar button, pull it back into the paper.          */
  /* ------------------------------------------------------------------ */
  var lastPointerAt = 0;
  function markPointer() { lastPointerAt = Date.now(); }
  D.addEventListener('pointerdown', markPointer, true);
  D.addEventListener('touchstart', markPointer, true);
  D.addEventListener('mousedown', markPointer, true);

  D.addEventListener('focusout', function (e) {
    try {
      if (!kbEditable(e.target)) return;
      setTimeout(function () {
        try {
          if (Date.now() - lastPointerAt < 900) return;   // deliberate tap elsewhere
          var a = D.activeElement;
          if (kbEditable(a)) return;                      // landed on another field
          if (!a || a === D.body || a === D.documentElement) return;
          kbLog('focus escaped to <' + a.tagName + '> -> pulling back');
          kbMove(1);
        } catch (e2) { }
      }, 0);
    } catch (err) { }
  }, true);

  try { W.console.log('[xxgg] Tab handler installed (two presses to advance)'); } catch (e) { }

  var isTouch = ('ontouchstart' in W) || (W.navigator && W.navigator.maxTouchPoints > 0);
  if (!isTouch) return;

  var SEL_POPUP = '.selection-popup';
  var MAIN = '.main-content';
  var TEXT_AREAS = '.main-content, .text-panel, .passage, .article, [class*="text-body"], [class*="reading"], [class*="article-body"]';

  var DOUBLE_TAP_MS = 320;
  var DOUBLE_TAP_PX = 36;
  var ARM_TIMEOUT_MS = 1200;

  var lastTapAt = 0;
  var lastTapX = 0;
  var lastTapY = 0;

  var armed = false;
  var fired = false;
  var armTimer = null;
  var retryTimers = [];

  var tapX = 0;
  var tapY = 0;

  var lastKey = '';
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
  /* Arming lifecycle                                                    */
  /* ------------------------------------------------------------------ */
  function clearRetries() {
    for (var i = 0; i < retryTimers.length; i++) clearTimeout(retryTimers[i]);
    retryTimers = [];
  }

  function disarm(reason) {
    if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    clearRetries();
    if (armed || fired) log('disarm (' + reason + ')');
    armed = false;
    fired = false;
  }

  function arm() {
    disarm('re-arm');
    armed = true;
    fired = false;
    lastKey = '';
    armTimer = setTimeout(function () { disarm('timeout'); }, ARM_TIMEOUT_MS);
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

  function firstTextNode(el) {
    try {
      if (!el) return null;
      var walker = D.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      return walker.nextNode();
    } catch (e) {
      return null;
    }
  }

  function wordRangeAt(x, y) {
    var base = caretRangeAt(x, y);
    if (!base) return null;

    var node = base.startContainer;
    var offset = base.startOffset;

    if (node && node.nodeType !== 3) {
      node = firstTextNode(node);
      offset = 0;
    }
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
        ' op=' + cs.opacity +
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

  /* ------------------------------------------------------------------ */
  /* Fire - one shot per double tap                                      */
  /* ------------------------------------------------------------------ */
  function fire(tag) {
    if (!armed || fired) {
      log('fire(' + tag + ') skipped armed=' + armed + ' fired=' + fired);
      return;
    }

    var sel = currentSelection();
    var source = 'native';

    if (!sel) {
      var r = wordRangeAt(tapX, tapY);
      if (r && installSelection(r)) {
        source = 'built';
        sel = currentSelection();
      } else {
        source = r ? 'install-failed' : 'build-failed';
      }
    }

    if (!sel) {
      log('fire(' + tag + ') no selection (source=' + source + ') at ' + Math.round(tapX) + ',' + Math.round(tapY));
      return; // stay armed so a later retry can succeed
    }

    var el = anchorElement(sel.range);
    var textAreaOk = inTextArea(el);

    var inMain = 'n/a';
    try {
      var main = D.querySelector(MAIN);
      var n = sel.range.commonAncestorContainer;
      inMain = main ? String(main.contains(n)) : 'no-main-content';
    } catch (e) { inMain = 'err'; }

    log('fire(' + tag + ') source=' + source + ' text="' + sel.text.slice(0, 22) +
      '" inTextArea=' + textAreaOk + ' inMainContent=' + inMain);

    if (!textAreaOk) {
      disarm('outside-text-area');
      return;
    }

    var rect = null;
    try { rect = sel.range.getBoundingClientRect(); } catch (e) { rect = null; }

    var key = sel.text + '|' + (rect ? Math.round(rect.left) + ',' + Math.round(rect.top) : '');
    if (key === lastKey) {
      log('fire(' + tag + ') deduped');
      return;
    }
    lastKey = key;

    var x = rect ? Math.round(rect.left + rect.width / 2) : tapX;
    var y = rect ? Math.round(rect.bottom) : tapY;

    var how = dispatchMouseUp(el, x, y);
    log('dispatched=' + how + ' at ' + x + ',' + y);

    // One shot: never re-fire for this double tap.
    fired = true;
    disarm('fired');

    setTimeout(function () { log('after 60ms  ' + popupReport()); }, 60);
    setTimeout(function () { log('after 300ms ' + popupReport()); }, 300);
  }

  /* ------------------------------------------------------------------ */
  /* Double-tap detection                                                */
  /* ------------------------------------------------------------------ */
  function touchPoint(e) {
    var t = (e.changedTouches && e.changedTouches[0]) || null;
    return t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Fill-in-the-blank: double tap acts like pressing Tab                */
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

    if (!isDouble) {
      // A plain tap must never build a selection. Let the app close its popup.
      return;
    }

    tapX = p.x;
    tapY = p.y;
    arm();
    log('DOUBLE TAP armed');

    retryTimers.push(setTimeout(function () { fire('t+70'); }, 70));
    retryTimers.push(setTimeout(function () { fire('t+240'); }, 240));
    retryTimers.push(setTimeout(function () { fire('t+450'); }, 450));
  }, true);

  /* ------------------------------------------------------------------ */
  /* Styling                                                             */
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
    oneShot: true,
    debug: DEBUG,
    disarm: disarm,
    fire: fire,
    logs: function () { return logs.slice(); }
  };

  log('module ready oneShot=true armTimeout=' + ARM_TIMEOUT_MS +
      ' dblTap=' + DOUBLE_TAP_MS + 'ms/' + DOUBLE_TAP_PX + 'px debug=' + DEBUG);
})();
