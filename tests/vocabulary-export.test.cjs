const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const api = require('../xxgg-vocabulary-export.js');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mainFile = html.match(/type="module"[^>]*src="\.\/([^"?]+)/)[1];
const main = fs.readFileSync(path.join(root, mainFile), 'utf8');
function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}

test('exports the requested optional fields, canonical parts of speech, meanings and synonymous expressions', () => {
  assert.equal(api.formatRow({ word: 'apple', pos: 'noun', glossZh: '苹果' }), 'apple | n. | 苹果');
  assert.equal(api.formatRow({ word: 'annual', pos: '形容词', glossZh: '每年的' }), 'annual | adj. | 每年的');
  assert.equal(api.formatRow({ word: 'contrast', pos: ['noun', 'verb'], glossZh: ['对比', '对照'] }), 'contrast | n. / v. | 对比；对照');
  assert.equal(api.formatRow({ word: 'resilience', phonetic: '/rɪˈzɪliəns/', pos: 'n.', glossZh: '韧性；恢复力' }),
    'resilience | /rɪˈzɪliəns/ | n. | 韧性；恢复力');
  assert.equal(api.formatRow({ word: 'look after', acceptedAnswers: ['look after', 'take care of'], pos: 'v.', glossZh: '照顾;照料' }),
    'look after / take care of | v. | 照顾；照料');
  assert.equal(api.formatRow({ word: 'apple', glossZh: '苹果' }), 'apple | 苹果');
  assert.equal(api.formatRow({ word: 'unknown' }), 'unknown');
  assert.equal(api.formatRow({ word: 'apple', acceptedAnswers: [' '] }), 'apple');
  assert.equal(api.formatRow({ word: 'a newspaper', glossZh: 'n. 报纸' }), 'a newspaper | n. | 报纸');
  assert.equal(api.formatRow({ word: 'abstract', glossZh: 'adj. 抽象的；n. 摘要' }), 'abstract | adj. / n. | 抽象的；摘要');
  assert.equal(api.formatRow({ word: 'contrast', glossZh: 'n. / v. 对比；对照' }), 'contrast | n. / v. | 对比；对照');
  assert.equal(api.formatRow({ word: 'a word', phonetics: { us: 'not a string' }, glossZh: '词' }), 'a word | 词');
});

test('Part 1/4 filters use inclusive membership and the combined option exports overlap only once', () => {
  const rows = [{ word: 'one', parts: ['1'] }, { word: 'four', parts: ['4'] },
    { word: 'both', parts: ['1', '4'] }, { word: 'two', parts: ['2'] }, { word: 'unknown' }];
  assert.deepEqual(api.filterParts(rows, '1').map(r => r.word), ['one', 'both']);
  assert.deepEqual(api.filterParts(rows, '4').map(r => r.word), ['four', 'both']);
  assert.deepEqual(api.filterParts(rows, '1,4').map(r => r.word), ['one', 'four', 'both']);
  assert.equal(api.filterParts(rows, 'all').length, 5);
  assert.equal(api.filterParts([{ parts: ['Part 1 / 4'] }], '1,4').length, 1);
  assert.equal(api.filterParts([{ parts: ['14'] }], '1,4').length, 0);
});

test('TXT keeps one word per line, no header, no fabricated glosses, and removes only identical exported lines', () => {
  const text = api.toText([{ word: 'apple', glossZh: '苹果' }, { word: 'apple', glossZh: '苹果' },
    { word: 'apple', glossZh: '苹果公司' }, { word: 'word\nphrase', glossZh: '释义|附注\n第二义' }]);
  assert.equal(text, 'apple | 苹果\napple | 苹果公司\nword phrase | 释义｜附注；第二义');
});

function surfaceHarness() {
  const watches = [];
  const copies = [], downloads = [];
  const ctx = vm.createContext({
    window: { __XXGG_VOCAB_EXPORT__: { ...api, copy: async text => copies.push(text), download: (text, name) => downloads.push({ text, name }) } },
    M: value => ({ value }), I: get => ({ get value() { return get(); } }),
    Ue: (source, fn, options = {}) => {
      watches.push({ source, fn });
      if (options.immediate) fn(typeof source === 'function' ? source() : source.value, undefined);
    }, St: async () => {}, L3: () => ({ dispose() {} }),
    Gt() {}, bn() {}, fo() {}, co() {}, y: value => value,
    na: 'vw-filter-menu', Q6: 96, Z6: 128, setTimeout, clearTimeout,
  });
  vm.runInContext(section(main, 'const h$=Object.freeze', 'const M$='), ctx);
  let component = section(main, 'X6={__name:"SpellingRecallCatalogSurface"', ',J6=["role"');
  component = component.replace('return Gt(()=>{Ve(),document.addEventListener',
    'globalThis.surfaceState={part:xxggPart,rows:te,bands:xxggBands,groups:Le,category:D,band:u,exportRows:xxggExportRows,ready:xxggExportReady,status:xxggExportStatus,setPart:xxggSetPart,runExport:xxggRunExport};return Gt(()=>{Ve(),document.addEventListener');
  vm.runInContext('const ' + component + ';globalThis.component=X6;', ctx);
  const props = Object.fromEntries(Object.entries(ctx.component.props).map(([key, spec]) => [key,
    typeof spec.default === 'function' && spec.type?.name !== 'Function' ? spec.default() : spec.default]));
  const rows = [
    { key: 'a', word: 'apple', category: 'regular', letter: 'A', parts: ['1'], state: 'latest_wrong', glossZh: '苹果' },
    { key: 'h', word: 'hotel', category: 'regular', letter: 'H', parts: ['1', '4'], state: 'latest_wrong', glossZh: '酒店' },
    { key: 'z', word: 'zebra', category: 'regular', letter: 'Z', parts: ['4'], state: 'latest_wrong', glossZh: '斑马' },
    { key: 'b', word: 'book', category: 'regular', letter: 'B', parts: ['2'], state: 'latest_wrong', glossZh: '书' },
    { key: 'c', word: 'correct', category: 'regular', letter: 'C', parts: ['1'], state: 'latest_correct', glossZh: '正确' },
    { key: 'code', word: 'code123', category: 'identifier_string', letter: 'C', parts: ['1'], state: 'latest_wrong' },
  ];
  Object.assign(props, { vocabularyWords: rows, vocabularyViewWords: rows, vocabularyLoaded: true,
    vocabularyViewer: 'authenticated', isAuthenticated: true, checkVocabularyAvailability: async () => true,
    vocabularyCounts: { all: 6, wrong: 5, correct: 1, unassessed: 0, hidden: 0 } });
  ctx.component.setup(props, { emit() {} });
  function flush() {
    for (const w of watches) {
      // Only the two selection stabilizers need simulated Vue watcher updates.
      if (typeof w.source === 'object' && !Array.isArray(w.source) && /Cf\(/.test(String(w.fn))) w.fn(w.source.value);
      if (typeof w.source === 'function' && /Ef\(/.test(String(w.fn))) w.fn(w.source());
    }
  }
  return { ctx, props, rows, state: ctx.surfaceState, copies, downloads, flush };
}

test('native surface combines state/Part/category filters, exports all letter bands and preserves optional metadata', async () => {
  const h = surfaceHarness();
  h.props.vocabularyFilter = 'wrong';
  await h.state.setPart('1,4'); h.flush();
  assert.equal(h.state.category.value, 'regular');
  assert.equal(h.state.band.value, 'ag');
  assert.deepEqual(Array.from(h.state.groups.value.flatMap(g => g.words), r => r.word), ['apple']);
  assert.deepEqual(Array.from(h.state.exportRows.value, r => r.word), ['apple', 'hotel', 'zebra']);
  await h.state.runExport('copy');
  assert.equal(h.copies[0], 'apple | 苹果\nhotel | 酒店\nzebra | 斑马');
  await h.state.runExport('download');
  assert.equal(h.downloads[0].text, h.copies[0]);
  assert.match(h.downloads[0].name, /\.txt$/);
  const enriched = h.ctx.xf({ ...h.rows[0], phonetic: '/ˈæpəl/', pos: 'noun' }, 'authenticated');
  assert.equal(api.formatRow(enriched), 'apple | /ˈæpəl/ | n. | 苹果');
  await h.state.setPart('1'); h.flush();
  assert.deepEqual(Array.from(h.state.exportRows.value, r => r.word), ['apple', 'hotel']);
  await h.state.setPart('4'); h.flush();
  assert.deepEqual(Array.from(h.state.exportRows.value, r => r.word), ['hotel', 'zebra']);
});

test('native export blocks partial pages, loading/errors, hidden-list loading and empty selections', async () => {
  const h = surfaceHarness();
  for (const key of ['vocabularyHasMore', 'vocabularyLoading', 'vocabularyLoadingMore', 'vocabularyReturnMasked']) {
    h.props[key] = true;
    assert.equal(h.state.ready.value, false, key);
    await h.state.runExport('copy'); assert.equal(h.copies.length, 0);
    h.props[key] = false;
  }
  h.props.vocabularyError = 'page failed'; assert.equal(h.state.ready.value, false);
  h.props.vocabularyError = ''; h.props.vocabularyHiddenView = true; h.props.vocabularyHiddenLoading = true;
  assert.equal(h.state.ready.value, false);
  h.props.vocabularyHiddenLoading = false; h.props.vocabularyHiddenError = 'failed';
  assert.equal(h.state.ready.value, false);
  h.props.vocabularyHiddenError = ''; h.props.vocabularyViewWords = [];
  assert.equal(h.state.ready.value, false);
});

test('clipboard permission failure falls back to selection; TXT downloads UTF-8 with Chinese text intact', async () => {
  const appended = [], focused = [], blobs = [], names = [], revoked = [];
  const window = {
    navigator: { clipboard: { writeText: async () => { throw Error('denied'); } } },
    document: { activeElement: { focus: () => focused.push('restored') },
      body: { appendChild: item => appended.push(item) }, execCommand: name => name === 'copy',
      createElement: type => ({ type, style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() {},
        click() { names.push(this.download); } }) },
    Blob: class { constructor(parts, options) { blobs.push({ parts, options }); } },
    URL: { createObjectURL: () => 'blob:export', revokeObjectURL: url => revoked.push(url) }, setTimeout: fn => fn(),
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'xxgg-vocabulary-export.js'), 'utf8'), { window });
  await window.__XXGG_VOCAB_EXPORT__.copy('apple | 苹果');
  assert.equal(appended[0].value, 'apple | 苹果'); assert.equal(focused.length, 1);
  window.__XXGG_VOCAB_EXPORT__.download('apple | 苹果', 'words.txt');
  assert.equal(blobs[0].parts.join(''), '\uFEFFapple | 苹果\n');
  assert.equal(blobs[0].options.type, 'text/plain;charset=utf-8');
  assert.deepEqual(names, ['words.txt']); assert.deepEqual(revoked, ['blob:export']);
});
