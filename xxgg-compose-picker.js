/**
 * xxgg-compose-picker.js
 * ---------------------------------------------------------------------------
 * "自选组卷" panel: choose the exact passages a composed paper should use.
 *
 * How it plugs in
 *   xxgg-server-compose.js intercepts POST /practice/v1/mixed-practice/compose
 *   and normally picks one passage per IELTS Part at random. It exposes
 *
 *     window.__xxggServerCompose.listUnits(channel) -> Promise<unit[]>
 *       unit = { unitId, titleEn, titleZh, channel, partNo, partRank }
 *
 *   This panel writes the picked unit ids to localStorage under
 *   `xxgg.compose.custom.v1`:
 *
 *     { enabled: true, channel: 'reading', unitIds: ['...', '...'] }
 *
 *   The compose handler reads that key and, when it matches the requested
 *   channel, uses exactly those passages (Part-ordered, capped at the paper's
 *   slot count) instead of the random picker. Fewer picks than slots is
 *   topped up from the rest so the paper stays valid.
 *
 * Nothing is sent anywhere by this file: it only reads the public unit
 * catalogue through the module above and stores a local selection.
 *
 * Source is ASCII-only: Chinese literals are \uXXXX escapes.
 */
(function () {
  'use strict';

  var W = window;
  if (!W || !W.document) return;
  var D = W.document;

  var CUSTOM_KEY = 'xxgg.compose.custom.v1';
  var NEED = { reading: 3, listening: 4 };

  var T = {
    toggle: '\u81ea\u9009\u7ec4\u5377',                 // 自选组卷
    title: '\u81ea\u9009\u7ec4\u5377',                  // 自选组卷
    reading: '\u9605\u8bfb',                            // 阅读
    listening: '\u542c\u529b',                          // 听力
    enable: '\u542f\u7528\u81ea\u9009',                 // 启用自选
    clear: '\u6e05\u7a7a',                              // 清空
    refresh: '\u5237\u65b0',                            // 刷新
    loading: '\u52a0\u8f7d\u4e2d\u2026',                // 加载中…
    empty: '\u6682\u65e0\u53ef\u9009\u7bc7\u76ee',      // 暂无可选篇目
    needLogin: '\u9700\u8981\u767b\u5f55\u540e\u4f7f\u7528', // 需要登录后使用
    failed: '\u52a0\u8f7d\u5931\u8d25',                 // 加载失败
    need: '\u9700\u8981',                               // 需要
    piece: '\u7bc7',                                    // 篇
    picked: '\u5df2\u9009',                             // 已选
    hint: '\u52fe\u9009\u540e\u70b9\u5e94\u7528\u91cc\u7684\u201c\u7ec4\u5377\u201d\uff0c\u5373\u53ef\u6309\u8fd9\u5957\u7bc7\u76ee\u51fa\u5377\u3002', // 勾选后点应用里的"组卷"，即可按这套篇目出卷。
    searchHint: '\u641c\u7d22\u7bc7\u76ee\u2026',          // 搜索篇目…
    noMatch: '\u6ca1\u6709\u5339\u914d\u7684\u7bc7\u76ee',  // 没有匹配的篇目
    lastFail: '\u4e0a\u6b21\u63d0\u4ea4\u5931\u8d25\uff1a',  // 上次提交失败：
    close: '\u2715'
  };

  var state = { open: false, channel: 'reading', units: [], loading: false, error: '', query: '' };

  /* ------------------------------------------------------------------ */
  /* storage                                                             */
  /* ------------------------------------------------------------------ */
  function lsGet(k) { try { return W.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { W.localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function readSel() {
    var p = null;
    try { p = JSON.parse(lsGet(CUSTOM_KEY) || 'null'); } catch (e) { p = null; }
    if (!p || typeof p !== 'object') p = {};
    var ids = [];
    if (Object.prototype.toString.call(p.unitIds) === '[object Array]') {
      for (var i = 0; i < p.unitIds.length; i++) {
        var s = String(p.unitIds[i] == null ? '' : p.unitIds[i]);
        if (s) ids.push(s);
      }
    }
    return {
      enabled: p.enabled !== false,
      channel: (p.channel === 'listening' || p.channel === 'reading') ? p.channel : 'reading',
      unitIds: ids
    };
  }

  function writeSel(sel) { lsSet(CUSTOM_KEY, JSON.stringify(sel)); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function api() {
    var h = W.__xxggServerCompose;
    if (h && h.enabled === true && typeof h.listUnits === 'function') return h;
    return null;
  }

  // Styled with the app's own design tokens so the panel reads as part of the
  // product rather than a bolt-on. Fallbacks match :root in the app bundle.
  var BTN = 'all:unset;box-sizing:border-box;cursor:pointer;padding:6px 12px;border-radius:6px;' +
    'border:1px solid var(--color-border-light,#e0e0e0);background:transparent;' +
    'color:var(--color-text-secondary,#666);font-size:12px;font-weight:600;line-height:1;' +
    'text-align:center;transition:background .12s,color .12s,border-color .12s;';
  var BTN_ON = 'background:var(--accent,#3a6ea8);color:#fff;border-color:var(--accent,#3a6ea8);';
  var SURFACE = 'var(--wc-menu-bg,#fff)';
  var SURFACE_FG = 'var(--wc-menu-fg,#232427)';
  var SURFACE_MUTED = 'var(--wc-menu-fg-muted,#71727a)';
  var LINE = 'var(--wc-menu-border,#e8e8e9)';

  /* ------------------------------------------------------------------ */
  /* shell                                                               */
  /* ------------------------------------------------------------------ */
  function ensureHost() {
    if (D.getElementById('xxgg-cp')) return;
    var host = D.createElement('div');
    host.id = 'xxgg-cp';
    host.setAttribute('style',
      'position:fixed;left:14px;bottom:14px;z-index:2147482000;display:flex;' +
      'flex-direction:column;align-items:flex-start;gap:8px;font-size:13px;line-height:1.5;');

    host.innerHTML =
      '<div id="xxgg-cp-panel" style="display:none;width:320px;max-height:70vh;flex-direction:column;' +
        'background:' + SURFACE + ';color:' + SURFACE_FG + ';border:1px solid ' + LINE + ';border-radius:8px;' +
        'box-shadow:0 8px 28px rgba(0,0,0,.14);overflow:hidden;">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid ' + LINE + ';">' +
          '<strong style="flex:1;font-size:13px;font-weight:600;">' + T.title + '</strong>' +
          '<button id="xxgg-cp-close" type="button" style="all:unset;cursor:pointer;color:' + SURFACE_MUTED + ';padding:0 4px;font-size:13px;">' + T.close + '</button>' +
        '</div>' +
        '<div id="xxgg-cp-tabs" style="display:flex;gap:6px;padding:10px 12px 0;"></div>' +
        '<div style="padding:10px 12px 0;">' +
          '<input id="xxgg-cp-search" type="search" autocomplete="off" placeholder="' + T.searchHint + '" style="all:unset;box-sizing:border-box;display:block;width:100%;padding:5px 8px;border:1px solid ' + LINE + ';border-radius:6px;background:transparent;color:' + SURFACE_FG + ';font-size:12px;">' +
        '</div>' +
        '<div style="padding:8px 12px;display:flex;align-items:center;gap:10px;">' +
          '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;">' +
            '<input id="xxgg-cp-enable" type="checkbox">' + T.enable + '</label>' +
          '<span id="xxgg-cp-count" style="margin-left:auto;color:' + SURFACE_MUTED + ';font-size:12px;"></span>' +
        '</div>' +
        '<div id="xxgg-cp-list" style="flex:1;overflow:auto;padding:0 12px 8px;min-height:60px;"></div>' +
        '<div style="display:flex;gap:8px;padding:10px 12px;border-top:1px solid ' + LINE + ';">' +
          '<button id="xxgg-cp-clear" type="button" style="' + BTN + 'flex:1;">' + T.clear + '</button>' +
          '<button id="xxgg-cp-refresh" type="button" style="' + BTN + 'flex:1;">' + T.refresh + '</button>' +
        '</div>' +
        '<div id="xxgg-cp-status" style="display:none;margin:0 12px 8px;padding:6px 8px;border-radius:6px;background:var(--auth-error-soft,rgba(213,76,76,.06));color:var(--auth-error,#c83a3a);font-size:12px;white-space:pre-wrap;word-break:break-all;"></div>' +
        '<div style="padding:0 12px 10px;color:' + SURFACE_MUTED + ';font-size:12px;">' + T.hint + '</div>' +
      '</div>' +
      '<button id="xxgg-cp-toggle" type="button" style="all:unset;box-sizing:border-box;cursor:pointer;' +
        'padding:6px 12px;border-radius:6px;border:1px solid ' + LINE + ';background:' + SURFACE + ';' +
        'color:' + SURFACE_FG + ';font-size:12px;font-weight:600;line-height:1;' +
        'box-shadow:0 1px 3px rgba(0,0,0,.08);transition:background .12s,border-color .12s;">' + T.toggle + '</button>';

    (D.body || D.documentElement).appendChild(host);
    wire();
  }

  function wire() {
    var on = function (id, ev, fn) {
      var el = D.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };
    on('xxgg-cp-toggle', 'click', function () { toggle(); });
    on('xxgg-cp-close', 'click', function () { setOpen(false); });
    on('xxgg-cp-clear', 'click', function () {
      var sel = readSel();
      sel.unitIds = [];
      writeSel(sel);
      renderList();
      renderCount();
    });
    on('xxgg-cp-refresh', 'click', function () { load(true); });
    on('xxgg-cp-search', 'input', function (e) {
      state.query = e.target.value || '';
      renderList();
    });
    on('xxgg-cp-enable', 'change', function (e) {
      var sel = readSel();
      sel.enabled = e.target.checked === true;
      writeSel(sel);
      renderCount();
    });
  }

  function setOpen(v) {
    state.open = v === true;
    var panel = D.getElementById('xxgg-cp-panel');
    if (panel) panel.style.display = state.open ? 'flex' : 'none';
    if (state.open && !state.units.length && !state.loading) load();
    if (state.open) { renderAll(); renderStatus(); }
  }

  function toggle() { ensureHost(); setOpen(!state.open); }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */
  function renderTabs() {
    var host = D.getElementById('xxgg-cp-tabs');
    if (!host) return;
    var html = '';
    var chans = [['reading', T.reading], ['listening', T.listening]];
    for (var i = 0; i < chans.length; i++) {
      var on = state.channel === chans[i][0];
      html += '<button type="button" data-chan="' + chans[i][0] + '" style="' + BTN +
        (on ? BTN_ON : '') + '">' + chans[i][1] + '</button>';
    }
    host.innerHTML = html;
    var btns = host.querySelectorAll('button[data-chan]');
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener('click', function (e) {
        var c = e.currentTarget.getAttribute('data-chan');
        if (c === state.channel) return;
        state.channel = c;
        var sel = readSel();
        sel.channel = c;
        sel.unitIds = [];
        writeSel(sel);
        state.units = [];
        renderAll();
        load();
      });
    }
  }

  function renderCount() {
    var el = D.getElementById('xxgg-cp-count');
    var sel = readSel();
    var need = NEED[state.channel] || 3;
    if (el) {
      el.textContent = T.picked + ' ' + sel.unitIds.length + ' / ' + T.need + ' ' + need + ' ' + T.piece +
        (sel.enabled ? '' : '  (' + T.enable + ': off)');
    }
    var en = D.getElementById('xxgg-cp-enable');
    if (en) en.checked = sel.enabled === true;
  }

  // Why the last submit failed, recorded by xxgg-server-compose.js. The panel
  // is the one surface the user opens on purpose, so the reason lands here
  // instead of in a toast.
  function renderStatus() {
    var el = D.getElementById('xxgg-cp-status');
    if (!el) return;
    var lines = [];

    try {
      var info = JSON.parse(lsGet('xxgg.compose.lastSubmit') || 'null');
      if (info && !info.ok && info.detail) {
        var when = '';
        try { when = info.at ? new Date(info.at).toLocaleTimeString() : ''; } catch (e) { when = ''; }
        lines.push(T.lastFail + (when ? '\uff08' + when + '\uff09' : '') + '\n' + String(info.detail));
      }
    } catch (e) { }

    // Which request made the app force-logout. Only set when one happened.
    try {
      var af = JSON.parse(lsGet('xxgg.auth.lastFailure') || 'null');
      if (af && af.at) {
        var w2 = '';
        try { w2 = new Date(af.at).toLocaleTimeString(); } catch (e) { w2 = ''; }
        lines.push('\u88ab\u9000\u767b\u7684\u8bf7\u6c42\uff08' + w2 + '\uff09\uff1aHTTP ' + af.status +
          '  code=' + (af.code || '-') + '\n' + af.path + (af.msg ? '\n' + af.msg : ''));
      }
    } catch (e) { }

    if (!lines.length) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.textContent = lines.join('\n\n');
  }

  function renderList() {
    var list = D.getElementById('xxgg-cp-list');
    if (!list) return;

    if (state.loading) { list.innerHTML = '<div style="padding:12px 0;color:#888;">' + T.loading + '</div>'; return; }
    if (state.error) { list.innerHTML = '<div style="padding:12px 0;color:#b00;">' + esc(state.error) + '</div>'; return; }
    if (!state.units.length) { list.innerHTML = '<div style="padding:12px 0;color:#888;">' + T.empty + '</div>'; return; }

    var sel = readSel();
    var picked = {};
    for (var i = 0; i < sel.unitIds.length; i++) picked[sel.unitIds[i]] = 1;

    // Search filter. Already-picked passages are kept in the list even when the
    // query excludes them, otherwise the user cannot uncheck what they picked.
    var q = String(state.query || '').trim().toLowerCase();
    var source = state.units;
    if (q) {
      source = [];
      for (i = 0; i < state.units.length; i++) {
        var su = state.units[i];
        var hay = (String(su.titleEn || '') + ' ' + String(su.titleZh || '') + ' ' +
          String(su.unitId || '')).toLowerCase();
        if (hay.indexOf(q) !== -1) source.push(su);
      }
      for (i = 0; i < state.units.length; i++) {
        var ku = state.units[i];
        if (picked[String(ku.unitId)] && source.indexOf(ku) === -1) source.push(ku);
      }
      if (!source.length) {
        list.innerHTML = '<div style="padding:12px 0;color:' + SURFACE_MUTED + ';">' + T.noMatch + '</div>';
        return;
      }
    }

    var groups = {};
    var order = [];
    for (i = 0; i < source.length; i++) {
      var u = source[i];
      var key = u.partNo ? String(u.partNo) : ('Part ' + (u.partRank || 99));
      if (!groups[key]) { groups[key] = { rank: u.partRank || 99, items: [] }; order.push(key); }
      groups[key].items.push(u);
    }
    order.sort(function (a, b) { return groups[a].rank - groups[b].rank; });

    var html = '';
    for (var g = 0; g < order.length; g++) {
      var k = order[g];
      html += '<div style="margin:10px 0 4px;font-weight:600;color:#333;font-size:12px;">' + esc(k) + '</div>';
      var items = groups[k].items;
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var id = String(it.unitId);
        var title = it.titleEn || it.titleZh || id;
        html += '<label style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer;">' +
          '<input type="checkbox" data-uid="' + esc(id) + '"' + (picked[id] ? ' checked' : '') + ' style="margin-top:3px;flex:none;">' +
          '<span style="flex:1;word-break:break-word;font-size:12px;">' + esc(title) +
          (it.titleZh && it.titleEn ? '<span style="color:#9a9a9a;"> \u00b7 ' + esc(it.titleZh) + '</span>' : '') +
          '</span></label>';
      }
    }
    list.innerHTML = html;

    var boxes = list.querySelectorAll('input[type=checkbox]');
    for (var b = 0; b < boxes.length; b++) boxes[b].addEventListener('change', onToggle);
  }

  function renderAll() {
    ensureHost();
    renderTabs();
    renderCount();
    renderList();
  }

  function onToggle(e) {
    var box = e.target;
    var id = box.getAttribute && box.getAttribute('data-uid');
    if (!id) return;
    var sel = readSel();
    var out = [];
    var seen = false;
    for (var i = 0; i < sel.unitIds.length; i++) {
      if (sel.unitIds[i] === id) {
        seen = true;
        if (box.checked) out.push(id);
      } else {
        out.push(sel.unitIds[i]);
      }
    }
    if (box.checked && !seen) out.push(id);
    sel.unitIds = out;
    writeSel(sel);
    renderCount();
  }

  /* ------------------------------------------------------------------ */
  /* data                                                                */
  /* ------------------------------------------------------------------ */
  function load(refresh) {
    var channel = state.channel;
    var sequence = (state.loadSequence || 0) + 1;
    state.loadSequence = sequence;
    var h = api();
    state.error = '';
    if (!h) {
      state.units = [];
      state.loading = false;
      state.error = T.needLogin;
      renderList();
      renderCount();
      return;
    }
    state.loading = true;
    renderList();
    Promise.resolve()
      .then(function () { return h.listUnits(channel, refresh === true); })
      .then(function (units) {
        if (state.loadSequence !== sequence || state.channel !== channel) return;
        state.loading = false;
        state.units = (units && units.length ? units : []).slice();
        for (var i = 0; i < state.units.length; i++) {
          var u = state.units[i];
          if (!u.unitId && u.id) u.unitId = u.id;
        }
        renderList();
        renderCount();
      }, function () {
        if (state.loadSequence !== sequence || state.channel !== channel) return;
        state.loading = false;
        state.error = T.failed;
        renderList();
      });
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */
  function boot() {
    try {
      ensureHost();
      var sel = readSel();
      state.channel = sel.channel;
      renderAll();
    } catch (e) { }
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot);
  else boot();
  try { setTimeout(boot, 1200); } catch (e) { }

  W.__xxggComposePicker = {
    open: function () { ensureHost(); setOpen(true); },
    reload: function () { ensureHost(); setOpen(true); load(true); },
    read: function () { return readSel(); }
  };
})();
