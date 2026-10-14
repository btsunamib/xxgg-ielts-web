/* Text export for the native vocabulary surface; no invented dictionary data. */
(function (root) {
  'use strict';
  function clean(value) {
    return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ')
      .replace(/\|/g, '｜').trim();
  }
  function first(row, keys) {
    for (var i = 0; row && i < keys.length; i++) {
      var value = row[keys[i]];
      if (value && typeof value === 'object' && !Array.isArray(value)) continue;
      if (Array.isArray(value) ? value.length : clean(value)) return value;
    }
    return '';
  }
  function list(value, separator, split) {
    var values = Array.isArray(value) ? value : String(value || '').split(split);
    return Array.from(new Set(values.map(clean).filter(Boolean))).join(separator);
  }
  function partOfSpeech(value) {
    var names = { noun: 'n.', n: 'n.', '名词': 'n.', verb: 'v.', v: 'v.', '动词': 'v.',
      adjective: 'adj.', adj: 'adj.', '形容词': 'adj.', adverb: 'adv.', adv: 'adv.', '副词': 'adv.' };
    var values = Array.isArray(value) ? value : String(value || '').split(/\s*[\/／;,；、]\s*/);
    return Array.from(new Set(values.map(function (v) {
      var text = clean(v), key = text.toLowerCase().replace(/\.$/, '');
      return names[key] || text;
    }).filter(Boolean))).join(' / ');
  }
  function metadata(row) {
    return {
      exportPhonetic: clean(first(row, ['exportPhonetic', 'phonetic', 'phonetics', 'ipa', 'pronunciation'])),
      exportPos: partOfSpeech(first(row, ['exportPos', 'pos', 'partOfSpeech', 'part_of_speech', 'wordType']))
    };
  }
  function parts(row) {
    var values = row && (row.parts || row.partNos || row.partNo) || [];
    if (!Array.isArray(values)) values = [values];
    var found = new Set();
    values.forEach(function (value) {
      if (value && typeof value === 'object') value = value.partNo;
      var text = clean(value);
      // The vocabulary API supplies ["1", "4"]; tolerate "Part 1 / 4" too.
      var matches = text.match(/(?:^|[^0-9])([1-4])(?=$|[^0-9])/g) || [];
      matches.forEach(function (match) { found.add(Number(match.match(/[1-4]/)[0])); });
    });
    return found;
  }
  function filterParts(rows, selected) {
    var wanted = selected === '1' ? [1] : selected === '4' ? [4] : selected === '1,4' ? [1, 4] : [];
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      if (!wanted.length) return true;
      var source = parts(row);
      return wanted.some(function (part) { return source.has(part); });
    });
  }
  function formatRow(row) {
    if (!row) return '';
    var english = Array.isArray(row.acceptedAnswers) && row.acceptedAnswers.length
      ? list(row.acceptedAnswers, ' / ', /\n/) : clean(row.word);
    if (!english) english = clean(row.word);
    if (!english) return '';
    var extra = metadata(row);
    var meaning = list(first(row, ['glossZh', 'meanings', 'meaning', 'translation', 'definitionZh']), '；', /[；;\r\n]+/);
    var embeddedPos = [];
    // Upstream often puts POS in glossZh, e.g. "adj. 抽象的；n. 摘要".
    // Extract only explicit POS markers at a definition/segment boundary.
    meaning = meaning.replace(/(^|[；;\/／]\s*)(n|v|adj|adv|prep|pron|conj|interj|int|num|det|art|aux|abbr|phr)\.\s*/gi,
      function (_, separator, pos) { embeddedPos.push(pos.toLowerCase() + '.'); return separator ? '；' : ''; });
    meaning = meaning.replace(/^[；\s]+|[；\s]+$/g, '').replace(/；+/g, '；');
    var pos = partOfSpeech([extra.exportPos].concat(embeddedPos).join(' / '));
    return [english, extra.exportPhonetic, pos, meaning].filter(Boolean).join(' | ');
  }
  function toText(rows) {
    return Array.from(new Set((Array.isArray(rows) ? rows : []).map(formatRow).filter(Boolean))).join('\n');
  }
  async function copy(text) {
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      try { await root.navigator.clipboard.writeText(text); return; } catch (_) { /* selection fallback */ }
    }
    var doc = root.document, active = doc.activeElement, area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
    doc.body.appendChild(area);
    try {
      area.focus(); area.select(); area.setSelectionRange(0, text.length);
      if (!doc.execCommand('copy')) throw new Error('复制失败，请使用下载 TXT。');
    } finally {
      area.remove();
      if (active && active.focus) active.focus({ preventScroll: true });
    }
  }
  function download(text, filename) {
    var url = root.URL.createObjectURL(new root.Blob(['\uFEFF', text + '\n'], { type: 'text/plain;charset=utf-8' }));
    var link = root.document.createElement('a');
    link.href = url; link.download = filename; link.style.display = 'none';
    root.document.body.appendChild(link);
    try { link.click(); } finally {
      link.remove(); root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 2000);
    }
  }
  var api = { metadata: metadata, filterParts: filterParts, formatRow: formatRow, toText: toText,
    copy: copy, download: download };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.__XXGG_VOCAB_EXPORT__ = api;
})(typeof window === 'undefined' ? null : window);
