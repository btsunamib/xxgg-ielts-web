/* xxgg-answer-extract -- source (contains real Chinese; asciified by _work/gen-extract.mjs) */
(function (global) {
  'use strict';

  var LABEL_JIEXI = '\u89e3\u6790';
  var LABEL_GANRAO = '\u5e72\u6270';

  var NEG_MARKERS = ['\u8ff7\u60d1', '\u9519\u9009', '\u4e0d\u9009', '\u8bef\u9009', '\u6392\u9664', '\u800c\u4e0d\u662f', '\u5e72\u6270\u9879', '\u9519\u8bef\u5730', '\u5f04\u6df7'];
  var GANRAO_MARKERS = ['\u6f0f\u586b\u7b54\u6848', '\u5ffd\u7565', '\u6f0f\u542c', '\u6ca1\u542c\u5230', '\u6ca1\u6293\u53d6\u5230', '\u9519\u8fc7', '\u6f0f\u4e86', '\u6f0f\u586b'];
  var NG_CUES = ['\u672a\u63d0\u53ca', '\u6ca1\u6709\u63d0\u5230', '\u6ca1\u6709\u8bf4', '\u6839\u672c\u6ca1', '\u65e0\u4e2d\u751f\u6709', '\u672a\u7ed9\u51fa', '\u6ca1\u6709\u660e\u786e', '\u5e76\u672a\u63d0\u5230', '\u65e0\u6cd5\u5f97\u77e5', '\u6ca1\u6709\u7ed9\u51fa', '\u6ca1\u6709\u8fdb\u884c', '\u6ca1\u6709\u5c06'];
  var FALSE_CUES = ['\u4e0d\u6b63\u786e', '\u4e0e\u539f\u6587\u4e0d\u7b26', '\u76f8\u53cd', '\u77db\u76fe', '\u4e0d\u7b26', '\u5e76\u975e', '\u800c\u4e0d\u662f', '\u9519\u8bef', '\u6709\u8bef'];
  var TRUE_CUES = ['\u8868\u8ff0\u5b8c\u5168\u4e00\u81f4', '\u5b8c\u5168\u4e00\u81f4', '\u4e00\u81f4', '\u76f8\u7b26', '\u543b\u5408', '\u7b26\u5408\u539f\u6587', '\u7b26\u5408', '\u6b63\u786e'];

  function isLabel(a, label) {
    return !!a && (a.labelsOne === label || a.labelsTwo === label);
  }
  function analyses(q) { return (q && q.analyses) || []; }

  function jiexiText(q) {
    var list = analyses(q), out = [];
    for (var i = 0; i < list.length; i++) if (isLabel(list[i], LABEL_JIEXI)) out.push(String(list[i].content || ''));
    return out.join('\n');
  }
  function ganraoText(q) {
    var list = analyses(q), out = [];
    for (var i = 0; i < list.length; i++) if (isLabel(list[i], LABEL_GANRAO)) out.push(String(list[i].content || ''));
    return out.join('\n');
  }

  function optionNums(q, ctx) {
    var out = [], seen = {}, i, n;
    var push = function (v) {
      v = v == null ? '' : String(v).toUpperCase();
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    };
    var opts = (q && q.options) || [];
    for (i = 0; i < opts.length; i++) push(opts[i] && opts[i].optionNum);
    if (!out.length && ctx && ctx.groupOptions) {
      for (i = 0; i < ctx.groupOptions.length; i++) push(ctx.groupOptions[i] && ctx.groupOptions[i].optionNum);
    }
    return out;
  }

  function optionContents(q, ctx) {
    var out = [], opts = (q && q.options) || [], i;
    for (i = 0; i < opts.length; i++) {
      if (!opts[i]) continue;
      out.push({ num: String(opts[i].optionNum || '').toUpperCase(), text: String(opts[i].optionContent || opts[i].option || '') });
    }
    if (!out.length && ctx && ctx.groupOptions) {
      for (i = 0; i < ctx.groupOptions.length; i++) {
        var o = ctx.groupOptions[i];
        if (o) out.push({ num: String(o.optionNum || '').toUpperCase(), text: String(o.optionContent || o.option || '') });
      }
    }
    return out;
  }

  /* Collect (letter, weighted-vote) from patterns, down-weighting negative context. */
  function collectLetters(text, patterns, base) {
    var found = [];
    if (!text) return found;
    for (var p = 0; p < patterns.length; p++) {
      var re = new RegExp(patterns[p], 'g'), m;
      while ((m = re.exec(text)) !== null) {
        var letter = String(m[1] || '').toUpperCase();
        if (!/^[A-H]$/.test(letter)) continue;
        var ctx = text.slice(Math.max(0, m.index - 16), m.index + m[0].length + 16);
        var neg = false;
        for (var j = 0; j < NEG_MARKERS.length; j++) if (ctx.indexOf(NEG_MARKERS[j]) >= 0) { neg = true; break; }
        found.push({ letter: letter, weight: (neg ? -1 : 1) * base });
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    }
    return found;
  }

  function tally(cands) {
    var score = {}, order = [], i, c;
    for (i = 0; i < cands.length; i++) {
      c = cands[i];
      if (!(c.letter in score)) { score[c.letter] = 0; order.push(c.letter); }
      score[c.letter] += c.weight;
    }
    var best = null;
    for (i = 0; i < order.length; i++) {
      if (best === null || score[order[i]] > score[best]) best = order[i];
    }
    if (best === null || score[best] <= 0) return null;
    var tied = order.filter(function (l) { return score[l] === score[best]; });
    return { letter: best, ambiguous: tied.length > 1, score: score[best] };
  }

  function pickLetter(cands, valid) {
    var t = tally(cands);
    if (!t) return null;
    if (valid && valid.length) {
      var allowed = t.letter && valid.indexOf(t.letter) >= 0;
      if (!allowed) {
        var alt = null;
        for (var i = 0; i < valid.length; i++) {
          var sub = tally(cands.filter(function (c) { return c.letter === valid[i]; }));
          if (sub && (!alt || sub.score > alt.score)) alt = sub;
        }
        if (alt) return { letter: alt.letter, ambiguous: t.ambiguous, validated: true, overridden: true };
        return { letter: t.letter, ambiguous: t.ambiguous, validated: false, overridden: false };
      }
      return { letter: t.letter, ambiguous: t.ambiguous, validated: true, overridden: false };
    }
    return { letter: t.letter, ambiguous: t.ambiguous, validated: false, overridden: false };
  }

  function tfngValue(text) {
    var i, s = { ng: 0, fa: 0, tr: 0 };
    for (i = 0; i < NG_CUES.length; i++) if (text.indexOf(NG_CUES[i]) >= 0) s.ng += 3;
    for (i = 0; i < FALSE_CUES.length; i++) if (text.indexOf(FALSE_CUES[i]) >= 0) s.fa += 3;
    for (i = 0; i < TRUE_CUES.length; i++) if (text.indexOf(TRUE_CUES[i]) >= 0) s.tr += 2;
    if (s.ng > 0) return { value: 'NOT GIVEN', score: s.ng };
    if (s.fa > 0) return { value: 'FALSE', score: s.fa };
    if (s.tr > 0) return { value: 'TRUE', score: s.tr };
    return null;
  }

  function isTfngSet(opts) {
    if (!opts || opts.length < 2 || opts.length > 3) return false;
    var blob = opts.map(function (o) { return o.text.toUpperCase(); }).join('|');
    return /NOT\s*GIVEN/.test(blob) || /TRUE/.test(blob) || /YES/.test(blob);
  }

  function letterForTfng(opts, value) {
    var want = value === 'TRUE' ? ['TRUE', 'YES'] : value === 'FALSE' ? ['FALSE', 'NO'] : ['NOT GIVEN', 'NOTGIVEN'];
    for (var i = 0; i < opts.length; i++) {
      var t = opts[i].text.toUpperCase().replace(/\s+/g, ' ');
      for (var j = 0; j < want.length; j++) if (t.indexOf(want[j]) >= 0) return opts[i].num || null;
    }
    return value === 'TRUE' ? 'A' : value === 'FALSE' ? 'B' : 'C';
  }

  /* ---------- fill-in-the-blank ---------- */

  function parenCandidates(text) {
    var out = [], re = /\uff08([^\uff08\uff09]*)\uff09/g, m;
    while ((m = re.exec(text)) !== null) {
      var raw = String(m[1] || '').trim();
      if (!raw) continue;
      var parts = raw.split(/[\uff0c,]/);
      var gloss = parts[0].trim();
      var annotation = null;
      for (var i = 1; i < parts.length; i++) {
        var am = parts[i].match(/\u5bf9\u5e94\s*([A-Za-z][A-Za-z'\- ]*)/);
        if (am) annotation = am[1].trim();
      }
      if (!/[A-Za-z]/.test(gloss)) continue;
      out.push({ gloss: gloss, annotated: !!annotation, annotation: annotation, index: m.index });
    }
    return out;
  }

  function spelledName(text) {
    var m = text.match(/\b([A-Z])(?:-([A-Z])){2,}\b/);
    if (!m) return null;
    return m[0].split('-').join('');
  }

  function wordsOf(s) {
    var m = String(s || '').toLowerCase().match(/[a-z][a-z'\-]*/g);
    return m || [];
  }

  function stripGivenWords(cand, blankText) {
    if (!blankText) return cand;
    var given = {}, w = wordsOf(blankText), i;
    for (i = 0; i < w.length; i++) given[w[i]] = 1;
    var cw = String(cand).split(/\s+/), keep = [];
    for (i = 0; i < cw.length; i++) {
      if (!given[cw[i].toLowerCase().replace(/[^a-z'\-]/g, '')]) keep.push(cw[i]);
    }
    return keep.length ? keep.join(' ') : cand;
  }

  function fibExtract(q, ctx) {
    var jx = jiexiText(q), gr = ganraoText(q);

    var spelled = spelledName(jx);
    if (spelled) return { answer: spelled, confidence: 'high', method: 'fib:spelled-name' };

    var cands = parenCandidates(jx);
    if (!cands.length) {
      var grSpelled = spelledName(gr);
      if (grSpelled) return { answer: grSpelled, confidence: 'medium', method: 'fib:spelled-name-ganrao' };
      return null;
    }

    var blankText = ctx && ctx.blankText ? String(ctx.blankText) : '';
    var chosen = null, method = null, confidence = 'low';

    /* 1. blank-context overlap: drop glosses already printed in the notes row */
    if (blankText) {
      var live = cands.filter(function (c) {
        return wordsOf(c.gloss).every(function (w) { return wordsOf(blankText).indexOf(w) < 0; });
      });
      if (live.length === 1) { chosen = live[0].gloss; method = 'fib:blank-context'; confidence = 'high'; }
      else if (live.length > 1) {
        var liveAnnotated = live.filter(function (c) { return !(c.annotated && blankText.toLowerCase().indexOf(String(c.annotation).toLowerCase()) >= 0); });
        if (liveAnnotated.length === 1) { chosen = liveAnnotated[0].gloss; method = 'fib:blank-context+annotation'; confidence = 'high'; }
        else if (liveAnnotated.length > 1) { chosen = liveAnnotated[0].gloss; method = 'fib:blank-context-multi'; confidence = 'low'; }
      }
    }

    /* 2. \u5e72\u6270 entry names the missed answer */
    if (!chosen && gr) {
      var best = null;
      for (var i = 0; i < GANRAO_MARKERS.length; i++) {
        var at = gr.indexOf(GANRAO_MARKERS[i]);
        if (at < 0) continue;
        var window_ = gr.slice(at, at + 60);
        for (var c = 0; c < cands.length; c++) {
          var g = cands[c].gloss;
          if (window_.toLowerCase().indexOf(g.toLowerCase()) >= 0 && (!best || g.length > best.length)) best = g;
        }
      }
      if (best) { chosen = best; method = 'fib:ganrao-marker'; confidence = 'medium'; }
    }

    /* 3. single un-annotated gloss */
    if (!chosen) {
      var plain = cands.filter(function (c) { return !c.annotated; });
      if (plain.length === 1) { chosen = plain[0].gloss; method = 'fib:paren-single'; confidence = 'high'; }
      else if (cands.length === 1) { chosen = cands[0].gloss; method = 'fib:paren-single'; confidence = 'high'; }
      else if (plain.length > 1) { chosen = plain[0].gloss; method = 'fib:paren-first-ambiguous'; confidence = 'low'; }
      else { chosen = cands[0].gloss; method = 'fib:paren-first-annotated'; confidence = 'low'; }
    }

    chosen = stripGivenWords(chosen, blankText);
    chosen = chosen.replace(/^[\s,.;:]+|[\s,.;:]+$/g, '');
    if (!chosen || !/[A-Za-z]/.test(chosen)) return null;
    return { answer: chosen, confidence: confidence, method: method };
  }

  /* ---------- entry ---------- */

  function extract(question, ctx) {
    if (!question || typeof question !== 'object') return { answer: null, confidence: 'low', method: 'none' };
    var jx = jiexiText(question);
    if (!jx) return { answer: null, confidence: 'low', method: 'none:no-jiexi' };

    var type = String(question.type || '');
    var valid = optionNums(question, ctx);
    var opts = optionContents(question, ctx);
    var picked = null;

    if (type === 'map') {
      picked = pickLetter(collectLetters(jx, ['([A-H])\\s*\u6bb5', '\u7b2c\\s*([A-H])\\s*\u6bb5'], 3), valid);
      if (!picked) picked = pickLetter(collectLetters(jx, ['\u5b57\u6bcd\\s*([A-H])', '([A-H])\\s*\u5b57\u6bcd'], 3), valid);
      if (!picked) picked = pickLetter(collectLetters(jx, ['([A-H])\\s*\u9009\u9879', '\u9009\u9879\\s*([A-H])'], 2), valid);
      if (picked) {
        return {
          answer: picked.letter,
          confidence: picked.ambiguous || !picked.validated ? 'medium' : 'high',
          method: picked.validated ? 'map:letter-validated' : 'map:letter'
        };
      }
      return { answer: null, confidence: 'low', method: 'map:none' };
    }

    if (type === 'matching' || type === 'multiple-choice' || type === 'single-choice') {
      if (type === 'single-choice' && isTfngSet(opts)) {
        var v = tfngValue(jx);
        if (v) return { answer: letterForTfng(opts, v.value), confidence: 'medium', method: 'choice:tfng-' + v.value.toLowerCase().replace(/\s+/g, '') };
        return { answer: null, confidence: 'low', method: 'choice:tfng-unresolved' };
      }
      picked = pickLetter(collectLetters(jx, ['\u9009\u9879\\s*([A-H])', '([A-H])\\s*\u9009\u9879'], 2), valid);
      if (picked) {
        return {
          answer: picked.letter,
          confidence: picked.ambiguous || !picked.validated ? 'medium' : 'high',
          method: picked.validated ? 'choice:option-letter-validated' : 'choice:option-letter'
        };
      }
      /* fallback: letter named only in the \u5e72\u6270 entry, in a positive phrase */
      var gr = ganraoText(question);
      picked = pickLetter(collectLetters(gr, ['([A-H])\\s*\u9009\u9879\\s*(\u51c6\u786e|\u6b63\u786e|\u6db5\u76d6|\u7b26\u5408)', '(?:\u51c6\u786e|\u6b63\u786e|\u6db5\u76d6|\u7b26\u5408)[^\u3002\uff1b]{0,10}([A-H])\\s*\u9009\u9879'], 2), valid);
      if (!picked) picked = pickLetter(collectLetters(gr, ['([A-H])\\s*\u9009\u9879'], 1), valid);
      if (picked) {
        return { answer: picked.letter, confidence: 'low', method: 'choice:ganrao-fallback' };
      }
      return { answer: null, confidence: 'low', method: 'choice:none' };
    }

    if (type === 'fill-in-the-blank') {
      var r = fibExtract(question, ctx);
      if (r) return r;
      return { answer: null, confidence: 'low', method: 'fib:none' };
    }

    return { answer: null, confidence: 'low', method: 'none:unknown-type' };
  }

  global.__xxggAnswerExtract = {
    extract: extract,
    _internals: { jiexiText: jiexiText, ganraoText: ganraoText, parenCandidates: parenCandidates, tfngValue: tfngValue }
  };
})(typeof window !== 'undefined' ? window : this);
