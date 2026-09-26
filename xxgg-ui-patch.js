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

  W.__xxggUiPatch = { hidden: ['ielts-rail-plan-link'] };
})();
