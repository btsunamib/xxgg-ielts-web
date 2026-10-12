/* Independent public catalogue heat ranking. Only public metadata is cached;
 * personal progress is loaded afresh through the existing unit-status API. */
(function (root) {
  'use strict';
  function buildAlbums(units) {
    return ['reading', 'listening'].map(function (channel, index) {
      var unique = new Map();
      units.forEach(function (unit) {
        var count = unit && unit.sevenDayReportTotal;
        if (!unit || unit.channel !== channel || !unit.id ||
            count === null || count === undefined || count === '' ||
            !Number.isFinite(Number(count)) || Number(count) < 0) return;
        // Preserve the first public source and its real album/entry identifiers.
        if (!unique.has(String(unit.id))) unique.set(String(unit.id), unit);
      });
      var slots = [];
      for (var part = 1; part <= (channel === 'reading' ? 3 : 4); part++) {
        var rows = Array.from(unique.values()).filter(function (unit) {
          return String(unit.partNo || '').replace(/\s/g, '').toLowerCase() === 'part' + part;
        }).sort(function (a, b) {
          return Number(b.sevenDayReportTotal) - Number(a.sevenDayReportTotal) ||
            (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
        });
        slots.push({ key: 'part:Part ' + part, label: 'Part ' + part,
          partNo: 'Part ' + part, channel: channel, displayOrder: part,
          count: Math.min(50, rows.length), totalCount: rows.length,
          publicRowLimit: 50, maxDisplayRows: 50, hasMore: false,
          list: rows.slice(0, 50).map(function (unit, rank) {
            var copy = Object.assign({}, unit, { rank: rank + 1 });
            delete copy.previousRank; delete copy.rankDelta;
            delete copy.previousSevenDayReportTotal;
            // Public catalogue cache must never carry an account's progress.
            ['progressStatus', 'myAccuracy', 'myAcc', 'resultId', 'lastAttemptAt',
              'lastSubmittedAt', 'submittedAt', 'status'].forEach(function (key) { delete copy[key]; });
            return copy;
          }) });
      }
      return { albumId: 'web-public-' + channel, channel: channel,
        title: '公开题库热度 Top 50',
        subtitle: '公开题库近7天考情次数排序 · 同次数按题目ID排序 · 无历史排名变化',
        tagText: channel === 'reading' ? '阅读公开榜' : '听力公开榜', groupId: 'web_public', groupCode: 'web_public',
        groupTitle: '公开题库热度', groupDisplayOrder: 5, displayOrder: index,
        publicRowLimit: 50, maxDisplayRows: 50, mixedPracticeVisible: true,
        slots: slots };
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildAlbums: buildAlbums };
  if (!root || !root.fetch || !root.Response || !root.__XXGG_WEB_CONFIG__) return;
  var base = root.__XXGG_WEB_CONFIG__.practiceApiBaseUrl;
  var api;
  try { api = new URL(base); } catch (_) { return; }
  var inner = root.fetch.bind(root), cached = null, expires = 0, pending = null;
  function accountToken() {
    try { return root.localStorage.getItem('token') || ''; } catch (_) { return ''; }
  }
  function hydrateProgress(albums, token) {
    // Deep-copy the public cache; this result belongs only to this request.
    var result = JSON.parse(JSON.stringify(albums));
    if (!token) return Promise.resolve(result);
    var rows = [], ids = [], seen = new Set(), statuses = new Map();
    result.forEach(function (album) { album.slots.forEach(function (slot) {
      slot.list.forEach(function (row) {
        rows.push(row);
        var id = String(row.id);
        if (!seen.has(id)) { seen.add(id); ids.push(id); }
      });
    }); });
    var next = 0;
    function worker() {
      var start = next; next += 50;
      if (start >= ids.length || accountToken() !== token) return Promise.resolve();
      var url = base.replace(/\/$/, '') + '/practice/v1/unit-status?unitIds=' +
        encodeURIComponent(ids.slice(start, start + 50).join(','));
      var controller = new root.AbortController();
      var timer = root.setTimeout(function () { controller.abort(); }, 15000);
      return inner(url, { method: 'GET', mode: 'cors', credentials: 'omit',
        headers: { Accept: 'application/json', token: token }, signal: controller.signal
      }).then(function (res) {
        if (!res.ok) throw new Error('Unit status unavailable');
        return res.json();
      }).then(function (body) {
        if (String(body.code) !== '200' || !body.data || !Array.isArray(body.data.list))
          throw new Error('Unit status invalid');
        body.data.list.forEach(function (status) {
          if (!status) return;
          var id = String(status.unitId == null ? status.id : status.unitId);
          if (seen.has(id)) statuses.set(id, status);
        });
      }).catch(function () {
        // Keep the public rows/averages available and retry progress next load.
      }).finally(function () { root.clearTimeout(timer); }).then(worker);
    }
    return Promise.all([worker(), worker(), worker()]).then(function () {
      if (accountToken() !== token) return result;
      rows.forEach(function (row) {
        var status = statuses.get(String(row.id));
        if (!status) return;
        ['progressStatus', 'myAccuracy', 'resultId', 'lastAttemptAt',
          'lastSubmittedAt', 'submittedAt'].forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(status, key)) row[key] = status[key];
        });
        // A missing account average must not erase the public average.
        if (status.averageAccuracy != null) row.averageAccuracy = status.averageAccuracy;
      });
      return result;
    });
  }
  function publicJson(path) {
    return inner(base.replace(/\/$/, '') + path, {
      method: 'GET', mode: 'cors', credentials: 'omit',
      headers: { Accept: 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('Public catalogue unavailable');
      return res.json();
    }).then(function (body) {
      if (String(body.code) !== '200' || !body.data || !Array.isArray(body.data.list))
        throw new Error('Public catalogue invalid');
      return body.data.list;
    });
  }
  function load() {
    if (cached && Date.now() < expires) return Promise.resolve(cached);
    if (pending) return pending;
    var query = '?includeEntryModes=memory_link%2Cspelling_recall';
    pending = publicJson('/practice/v1/albums' + query).then(function (albums) {
      var results = new Array(albums.length), next = 0;
      function worker() {
        var i = next++;
        if (i >= albums.length) return Promise.resolve();
        return publicJson('/practice/v1/albums/' + encodeURIComponent(albums[i].id) + '/units' + query)
          .then(function (rows) { results[i] = rows; return worker(); });
      }
      return Promise.all([worker(), worker(), worker(), worker()]).then(function () {
        cached = buildAlbums([].concat.apply([], results));
        expires = Date.now() + 300000;
        return cached;
      });
    }).finally(function () { pending = null; });
    return pending;
  }
  root.fetch = function (input, init) {
    var url;
    try { url = new URL(typeof input === 'string' ? input : input.url); } catch (_) { return inner(input, init); }
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method !== 'GET' || url.origin !== api.origin ||
        url.pathname !== api.pathname.replace(/\/$/, '') + '/practice/v1/high-frequency/albums')
      return inner(input, init);
    var token = accountToken();
    return inner(input, init).then(function (res) {
      if (!res.ok) return res;
      return res.clone().json().then(function (body) {
        if (String(body.code) !== '200' || !body.data || !Array.isArray(body.data.list)) return res;
        return load().then(function (albums) { return hydrateProgress(albums, token); }).then(function (albums) {
          body.data.list = albums.concat(body.data.list);
          return new root.Response(JSON.stringify(body), { status: res.status,
            statusText: res.statusText, headers: res.headers });
        });
      }).catch(function () {
        // A failed public source leaves the official list intact; retry later.
        return res;
      });
    });
  };
})(typeof window === 'undefined' ? null : window);
