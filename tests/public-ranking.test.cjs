const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../xxgg-public-ranking.js'), 'utf8');
const { buildAlbums } = require('../xxgg-public-ranking.js');
const unit = (id, count, channel = 'reading', partNo = 'Part 1') => ({
  id: String(id), albumId: 'source-album', channel, partNo,
  sevenDayReportTotal: count, entryMode: 'exam', available: true
});
test('50 unique rows per Part, numerical heat sort, deterministic ties and source identifiers', () => {
  const rows = Array.from({ length: 65 }, (_, i) => unit(i, i));
  rows.push(unit(64, 1000), unit('tie-b', 64), unit('tie-a', 64));
  const slot = buildAlbums(rows)[0].slots[0];
  assert.equal(slot.list.length, 50);
  assert.equal(slot.totalCount, 67);
  assert.deepEqual(slot.list.slice(0, 3).map(r => r.id), ['64', 'tie-a', 'tie-b']);
  assert.equal(slot.list[0].sevenDayReportTotal, 64);
  assert.equal(slot.list[0].albumId, 'source-album');
  assert.equal(slot.list[49].rank, 50);
  assert.equal(slot.hasMore, false);
});
test('channels and Parts stay separate; missing heat is excluded, zero heat retained, no history invented', () => {
  const a = buildAlbums([unit('a', 0), unit('b', null), unit('c', undefined),
    unit('d', 'x'), unit('e', -1), unit('f', 30, 'listening', 'Part 4'),
    Object.assign(unit('g', 4, 'reading', 'Part 2'), { previousRank: 8, rankDelta: 2 })]);
  assert.equal(a[0].slots.length, 3); assert.equal(a[1].slots.length, 4);
  assert.deepEqual(a[0].slots[0].list.map(r => r.id), ['a']);
  assert.equal(a[1].slots[3].list[0].id, 'f');
  assert.equal('previousRank' in a[0].slots[1].list[0], false);
  assert.equal('rankDelta' in a[0].slots[1].list[0], false);
});
function setup(fail = false) {
  const calls = [];
  const official = { albumId: 'official', slots: [{ list: [unit('official', 8)] }] };
  const window = { Response, __XXGG_WEB_CONFIG__: { practiceApiBaseUrl: 'https://api.test/api' },
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      calls.push({ url, init });
      if (url.includes('/high-frequency/albums'))
        return new Response(JSON.stringify({ code: '200', data: { list: [official] } }));
      if (url.includes('/units')) {
        if (fail) throw new Error('Offline');
        return new Response(JSON.stringify({ code: '200', data: { list: [unit('public', 4)] } }));
      }
      return new Response(JSON.stringify({ code: '200', data: { list: [{ id: 'public-source' }] } }));
    } };
  vm.runInNewContext(source, { window, URL, Map, Number, Date, Promise });
  return { window, calls, official };
}
test('adds public albums, preserves official data, never copies auth to public requests, caches only public data', async () => {
  const { window, calls, official } = setup();
  const url = 'https://api.test/api/practice/v1/high-frequency/albums';
  const init = { headers: { token: 'mock-account' } };
  const results = await Promise.all([window.fetch(url, init), window.fetch(url, init)]);
  const body = await results[0].json();
  assert.equal(body.data.list.length, 3);
  assert.deepEqual(body.data.list[2], official);
  const publicCalls = calls.filter(c => !c.url.includes('/high-frequency/'));
  assert.equal(publicCalls.length, 2);
  for (const c of publicCalls) {
    assert.equal(c.init.credentials, 'omit');
    assert.deepEqual(Object.keys(c.init.headers), ['Accept']);
  }
  await window.fetch(url, { headers: { token: 'other-mock-account' } });
  assert.equal(calls.filter(c => !c.url.includes('/high-frequency/')).length, 2);
});
test('failure leaves original official response intact; other origins, rows and non-GET pass through', async () => {
  const { window, calls, official } = setup(true);
  const url = 'https://api.test/api/practice/v1/high-frequency/albums';
  const body = await (await window.fetch(url)).json();
  assert.deepEqual(body.data.list, [official]);
  const before = calls.length;
  await window.fetch(url, { method: 'POST' });
  await window.fetch(url.replace('api.test', 'other.test'));
  await window.fetch(url + '/official/slots/part/rows');
  assert.equal(calls.length - before, 3);
});

function progressHarness(units, getStatus, token = 'student-a') {
  const calls = [];
  const window = {
    Response, AbortController, setTimeout, clearTimeout,
    localStorage: { getItem: () => token },
    __XXGG_WEB_CONFIG__: { practiceApiBaseUrl: 'https://api.test/api' },
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      calls.push({ url, init });
      let list;
      if (url.pathname.endsWith('/high-frequency/albums')) list = [{ albumId: 'official', slots: [] }];
      else if (url.pathname.endsWith('/unit-status')) {
        list = await getStatus(url.searchParams.get('unitIds').split(','), init);
      } else if (url.pathname.endsWith('/units')) list = units;
      else list = [{ id: 'source' }];
      return new Response(JSON.stringify({ code: '200', data: { list } }));
    }
  };
  vm.runInNewContext(source, { window, URL, Map, Set, Number, Date, Promise });
  return {
    calls, switchAccount: value => { token = value; },
    load: async () => (await (await window.fetch('https://api.test/api/practice/v1/high-frequency/albums')).json()).data.list
  };
}

test('progress maps by source unit ID, retains 0%, result links and public averages, and refreshes without caching personal data', async () => {
  let finished = false;
  const h = progressHarness([
    { ...unit('a', 8), averageAccuracy: 65 },
    { ...unit('b', 4), averageAccuracy: 80, myAccuracy: 99, progressStatus: 'done', resultId: 'stale' }
  ], ids => ids.slice().reverse().map(id => id === 'a'
    ? { unitId: id, progressStatus: finished ? 'done' : 'todo', myAccuracy: finished ? 0 : null,
      resultId: finished ? 'result-a' : null, lastAttemptAt: finished ? '2026-10-12T01:00:00Z' : null,
      averageAccuracy: null }
    : { unitId: id, progressStatus: 'checking', myAccuracy: null, resultId: null, averageAccuracy: 75 }));
  const first = await h.load();
  assert.equal(first[0].slots[0].list[0].progressStatus, 'todo');
  assert.equal(first[0].slots[0].list[1].myAccuracy, null);
  finished = true;
  const second = await h.load();
  const a = second[0].slots[0].list[0], b = second[0].slots[0].list[1];
  assert.equal(a.progressStatus, 'done'); assert.equal(a.myAccuracy, 0);
  assert.equal(a.averageAccuracy, 65); assert.equal(a.resultId, 'result-a');
  assert.equal(a.lastAttemptAt, '2026-10-12T01:00:00Z');
  assert.equal(b.progressStatus, 'checking'); assert.equal(b.averageAccuracy, 75);
  assert.equal(first[0].slots[0].list[0].myAccuracy, null, 'previous responses are immutable');
  const publicCalls = h.calls.filter(c => !/high-frequency|unit-status/.test(c.url.pathname));
  assert.equal(publicCalls.length, 2, 'public catalogue remains cached');
  publicCalls.forEach(c => {
    assert.deepEqual(Object.keys(c.init.headers), ['Accept']);
    assert.equal(c.init.credentials, 'omit');
  });
  const privateCalls = h.calls.filter(c => c.url.pathname.endsWith('/unit-status'));
  assert.equal(privateCalls.length, 2, 'progress is read on every refresh');
  privateCalls.forEach(c => assert.equal(c.init.headers.token, 'student-a'));
});

test('all seven Top 50 Parts get progress in batches of 50 with at most three concurrent requests', async () => {
  const units = [];
  for (const channel of ['reading', 'listening']) {
    for (let part = 1; part <= (channel === 'reading' ? 3 : 4); part++) {
      for (let i = 0; i < 55; i++) units.push(unit(`${channel}-${part}-${i}`, i, channel, `Part ${part}`));
    }
  }
  let active = 0, peak = 0;
  const h = progressHarness(units, async ids => {
    assert.ok(ids.length <= 50);
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return ids.map(unitId => ({ unitId, progressStatus: 'done', myAccuracy: 100 }));
  });
  const albums = await h.load();
  const rows = albums.slice(0, 2).flatMap(a => a.slots.flatMap(s => s.list));
  assert.equal(rows.length, 350);
  assert.ok(rows.every(r => r.progressStatus === 'done' && r.myAccuracy === 100));
  assert.equal(h.calls.filter(c => c.url.pathname.endsWith('/unit-status')).length, 7);
  assert.equal(peak, 3);
});

test('account changes during an in-flight status read discard old progress; next load uses the new account', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const h = progressHarness([unit('a', 3)], async (ids, init) => {
    if (init.headers.token === 'student-a') { entered(); await gate; }
    return [{ unitId: 'a', progressStatus: 'done', myAccuracy: init.headers.token === 'student-a' ? 90 : 40 }];
  });
  const pending = h.load(); await started;
  h.switchAccount('student-b'); release();
  const old = await pending;
  assert.equal(old[0].slots[0].list[0].myAccuracy, undefined);
  assert.equal(old[0].slots[0].list[0].progressStatus, undefined);
  const current = await h.load();
  assert.equal(current[0].slots[0].list[0].myAccuracy, 40);
  h.switchAccount('');
  const loggedOut = await h.load();
  assert.equal(loggedOut[0].slots[0].list[0].myAccuracy, undefined);
});

test('a failed status read keeps public/official lists available and retries on the next refresh', async () => {
  let failed = true;
  const h = progressHarness([{ ...unit('a', 3), averageAccuracy: 70 }], () => {
    if (failed) throw new Error('offline');
    return [{ unitId: 'a', progressStatus: 'done', myAccuracy: 60 }];
  });
  const first = await h.load();
  assert.equal(first.length, 3); assert.equal(first[2].albumId, 'official');
  assert.equal(first[0].slots[0].list[0].averageAccuracy, 70);
  assert.equal(first[0].slots[0].list[0].myAccuracy, undefined);
  failed = false;
  assert.equal((await h.load())[0].slots[0].list[0].myAccuracy, 60);
});

test('shipped ranking defaults to accuracy while preserving report-count selection and completion mapping', () => {
  const bundle = fs.readFileSync(path.join(__dirname, '../assets/index-c56b88fb.js'), 'utf8');
  const section = (start, end) => {
    const a = bundle.indexOf(start), b = bundle.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return bundle.slice(a, b);
  };
  const ctx = vm.createContext({});
  vm.runInContext([
    'const ' + section('Ao=Object.freeze(', 'function Dv('),
    section('function gN(', 'const pN='),
    section('function Dv(', 'function cN('),
    section('function dN(', 'function ia('),
    section('function sa(', 'function fN('),
    section('function rv(', 'function ja('),
    'globalThis.defaults=dN; globalThis.choose=sa; globalThis.mapStatus=rv;'
  ].join('\n'), ctx);
  const defaults = ctx.defaults();
  assert.equal(defaults.defaultDisplayMode, 'accuracy');
  assert.equal(ctx.choose(undefined, defaults, true), 'accuracy');
  assert.equal(ctx.choose(undefined, defaults, false), 'accuracy');
  assert.equal(ctx.choose(undefined, undefined, true), 'accuracy', 'real fallback must also default to accuracy');
  assert.equal(ctx.choose(undefined, undefined, false), 'accuracy');
  assert.equal(ctx.choose('reportCount', defaults, true), 'reportCount');
  assert.equal(ctx.defaults({ display: ['reportCount'] }).defaultDisplayMode, 'reportCount');
  const mapped = ctx.mapStatus({ progressStatus: 'done', myAccuracy: 0, averageAccuracy: 70 });
  assert.equal(mapped.status, 'done'); assert.equal(mapped.myAcc, 0); assert.equal(mapped.avgAcc, 70);
  assert.ok(bundle.includes('c=M("accuracy"),h=I(()=>dN'));
  assert.ok(bundle.includes('vc=M("accuracy"),pc=M([])'));
});
