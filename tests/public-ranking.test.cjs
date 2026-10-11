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
