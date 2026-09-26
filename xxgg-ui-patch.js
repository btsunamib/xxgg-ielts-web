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

  W.__xxggUiPatch = { hidden: ['ielts-rail-plan-link'] };
})();
