/** Inline passage editor mounted by the app's MixedPracticeModal.
 * Choices stay in this draft. Applying creates a new composition through the
 * normal controller; changing titles alone must never change a live paper.
 */
(function () {
  'use strict';
  var W = window, D = W.document;
  if (!D) return;

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function rank(unit) {
    var n = Number(unit && unit.partRank);
    if (n >= 1 && n <= 4) return n;
    var match = String(unit && (unit.partNo || unit.slot) || '').match(/(?:part|section|p)\s*([1-4])/i);
    return match ? Number(match[1]) : 0;
  }
  function legacy(channel) {
    try {
      var saved = JSON.parse(W.localStorage.getItem('xxgg.compose.custom.v1') || 'null');
      return saved && saved.enabled !== false && saved.channel === channel && Array.isArray(saved.unitIds)
        ? saved.unitIds.slice() : [];
    } catch (e) { return []; }
  }
  function styles() {
    if (D.getElementById('xxgg-compose-editor-style')) return;
    var el = D.createElement('style');
    el.id = 'xxgg-compose-editor-style';
    el.textContent = ".app-shell .app-shell__body .pack-overlay.mix-overlay{position:fixed;inset:var(--titlebar-h,36px) 0 0;display:flex;align-items:center;justify-content:center;padding:clamp(8px,2vw,24px);padding-bottom:max(8px,env(safe-area-inset-bottom));overflow:hidden}" +
      ".pack-overlay.mix-overlay .pack-modal.mix-modal{width:min(720px,100%);min-width:0;max-height:100%;display:flex;flex-direction:column}" +
      ".mix-modal .pack-modal-hd,.mix-modal .pack-modal-ft{flex:none}" +
      ".mix-modal .mix-modal-bd{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}" +
      ".mix-modal .mix-result-list .mix-result-row{grid-template-columns:auto minmax(0,1fr) auto auto;column-gap:8px}" +
      ".mix-modal .mix-result-row .mix-result-summary-edit{border:1px solid var(--border,#e0e0e0);border-radius:6px;padding:5px 8px;margin:0;color:var(--accent,#3a6ea8);white-space:nowrap}" +
      ".mix-modal .mix-section .mix-seg-btn{display:flex;align-items:center;justify-content:center;white-space:nowrap}.mix-modal .mix-section.xxgg-compose-editor{font-size:13px;color:var(--color-text-primary,#232427);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);column-gap:16px;align-items:start}" +
      ".xxgg-compose-editor *{box-sizing:border-box}" +
      ".xxgg-compose-editor>.xxgg-ce-head,.xxgg-compose-editor>p,.xxgg-compose-editor>.xxgg-ce-actions{grid-column:1/-1}" +
      ".xxgg-ce-slots{min-width:0}.xxgg-ce-head,.xxgg-ce-row,.xxgg-ce-actions{display:flex;align-items:center;gap:10px}" +
      ".xxgg-ce-head{justify-content:space-between;margin:12px 0;flex-wrap:wrap}.xxgg-ce-muted{color:var(--color-text-secondary,#71727a);font-size:12px}" +
      ".xxgg-ce-row{padding:11px 12px;border:1px solid var(--color-border-light,#e0e0e0);border-radius:8px;margin:7px 0}" +
      ".xxgg-ce-row.is-active{border-color:var(--accent,#3a6ea8);background:var(--accent-soft,rgba(58,110,168,.05))}" +
      ".xxgg-ce-part{font-weight:600;flex:none}.xxgg-ce-title{flex:1;min-width:0;overflow-wrap:anywhere}" +
      ".xxgg-ce-btn{font:inherit;font-size:12px;cursor:pointer;padding:7px 11px;line-height:1.3;border-radius:6px;border:1px solid var(--color-border-light,#e0e0e0);color:inherit;background:transparent;flex:none}" +
      ".xxgg-ce-btn:disabled{cursor:default;opacity:.45}.xxgg-ce-btn:focus-visible,.xxgg-ce-search:focus-visible{outline:2px solid var(--accent,#3a6ea8);outline-offset:2px}" +
      ".xxgg-ce-primary{background:var(--accent,#3a6ea8);border-color:var(--accent,#3a6ea8);color:#fff}" +
      ".xxgg-ce-browser{min-width:0;margin:7px 0 12px;padding:12px;border:1px solid var(--color-border-light,#e0e0e0);border-radius:8px}" +
      ".xxgg-ce-search{display:block;width:100%;min-width:0;padding:8px 10px;margin:8px 0;border:1px solid var(--color-border-light,#e0e0e0);border-radius:6px;background:transparent;color:inherit;font:inherit}" +
      ".xxgg-ce-list{max-height:clamp(120px,32vh,320px);max-height:clamp(120px,32dvh,320px);overflow:auto;overscroll-behavior:contain}.xxgg-ce-option{padding:9px 0;border-bottom:1px solid var(--color-border-light,#e0e0e0);overflow-wrap:anywhere}" +
      ".xxgg-ce-actions{position:sticky;bottom:-14px;z-index:1;justify-content:flex-end;flex-wrap:wrap;margin-top:14px;padding:12px 0;background:var(--bg,#fff)}.xxgg-ce-error{color:var(--auth-error,#c83a3a);margin:10px 0;font-size:12px}" +
      "@media(max-width:640px){.mix-modal .mix-section.xxgg-compose-editor{display:block}.mix-modal.mix-modal .pack-modal-hd,.mix-modal.mix-modal .mix-modal-bd,.mix-modal.mix-modal .pack-modal-ft{padding-left:12px;padding-right:12px}.mix-modal .pack-modal-ft{flex-wrap:wrap}.xxgg-ce-row{padding:9px 8px;gap:7px}.xxgg-ce-btn{padding:7px 9px}.xxgg-ce-list{max-height:clamp(100px,25vh,220px);max-height:clamp(100px,25dvh,220px)}}" +
      "@media(max-width:480px){.mix-modal .mix-result-list .mix-result-row{grid-template-columns:auto minmax(0,1fr) auto;row-gap:6px}.mix-modal .mix-result-summary-edit{grid-column:2/-1;justify-self:end}.mix-modal .mix-result-title{overflow-wrap:anywhere;white-space:normal}.mix-modal .mix-result-tip{flex-wrap:wrap}}";
    (D.head || D.documentElement).appendChild(el);
  }

  function mount(root, options) {
    options = options || {};
    styles();
    var channel = options.channel === 'listening' ? 'listening' : 'reading';
    var need = channel === 'listening' ? 4 : 3;
    var units = [], selected = new Array(need).fill(null);
    var active = Number.isInteger(options.focusIndex) && options.focusIndex >= 0 ? options.focusIndex : 0;
    var query = '', loading = true, busy = false, error = '', disposed = false, sequence = 0;
    var prior = Array.isArray(options.slots) ? options.slots : [];
    for (var i = 0; i < prior.length; i++) {
      var part = rank(prior[i]) || i + 1;
      if (part <= need) selected[part - 1] = prior[i];
    }
    root.classList.add('xxgg-compose-editor');

    function id(unit) { return String(unit && (unit.unitId || unit.id) || ''); }
    function title(unit) { return unit ? unit.titleEn || unit.title || unit.titleZh || id(unit) : '尚未选择篇目'; }
    function complete() {
      return !loading && selected.every(function (u, index) {
        return u && rank(u) === index + 1 && units.some(function (candidate) { return id(candidate) === id(u); });
      });
    }
    function bind(action, handler) {
      var elements = root.querySelectorAll('[data-ce-action="' + action + '"]');
      for (var i = 0; i < elements.length; i++) elements[i].addEventListener('click', handler);
    }
    function render() {
      if (disposed) return;
      var count = selected.filter(Boolean).length;
      var html = '<div class="xxgg-ce-head"><strong>' + (prior.length ? '调整本套篇目' : '自选篇目') + '</strong>' +
        '<span class="xxgg-ce-muted">已选 ' + count + ' / ' + need + ' 篇</span></div>' +
        '<p class="xxgg-ce-muted">每个 Part 选择一篇。确认后按这份清单生成试卷。</p><div class="xxgg-ce-slots">';
      for (var i = 0; i < need; i++) {
        html += '<div class="xxgg-ce-row' + (active === i ? ' is-active' : '') + '">' +
          '<span class="xxgg-ce-part">P' + (i + 1) + '</span><span class="xxgg-ce-title">' + esc(title(selected[i])) + '</span>' +
          '<button type="button" class="xxgg-ce-btn" data-ce-action="edit" data-index="' + i + '" aria-label="' +
          (selected[i] ? '替换' : '选择') + ' P' + (i + 1) + ' 篇目"' + (busy ? ' disabled' : '') + '>' +
          (selected[i] ? '替换' : '选择') + '</button></div>';
      }
      html += '</div>';
      if (active >= 0 && active < need) html += '<div class="xxgg-ce-browser"><div class="xxgg-ce-head"><strong>选择 P' +
        (active + 1) + ' 篇目</strong><button type="button" class="xxgg-ce-btn" data-ce-action="refresh"' +
        (busy || loading ? ' disabled' : '') + '>刷新题库</button></div>' +
        '<input type="search" class="xxgg-ce-search" aria-label="搜索 P' + (active + 1) + ' 篇目" placeholder="搜索英文或中文标题" value="' +
        esc(query) + '"' + (busy ? ' disabled' : '') + '><div class="xxgg-ce-list"></div></div>';
      if (error) html += '<p class="xxgg-ce-error" role="alert">' + esc(error) + '</p>';
      html += '<div class="xxgg-ce-actions"><button type="button" class="xxgg-ce-btn" data-ce-action="cancel"' +
        (busy ? ' disabled' : '') + '>取消' + (prior.length ? '调整' : '自选') + '</button>' +
        '<button type="button" class="xxgg-ce-btn xxgg-ce-primary" data-ce-action="apply"' +
        (busy || !complete() ? ' disabled' : '') + '>' + (busy ? '正在组卷…' : prior.length ? '应用调整' : '按所选篇目组卷') + '</button></div>';
      root.innerHTML = html;
      bind('edit', function (event) { active = Number(event.currentTarget.getAttribute('data-index')); query = ''; render(); });
      bind('refresh', function () { load(true); });
      bind('cancel', function () { if (typeof options.onCancel === 'function') options.onCancel(); });
      bind('apply', apply);
      var search = root.querySelector('.xxgg-ce-search');
      if (search) search.addEventListener('input', function (event) { query = event.target.value; renderCandidates(); });
      renderCandidates();
    }
    function renderCandidates() {
      var list = root.querySelector('.xxgg-ce-list');
      if (!list) return;
      if (loading) { list.innerHTML = '<p class="xxgg-ce-muted" role="status">题库加载中…</p>'; return; }
      var matches = units.filter(function (u) {
        return rank(u) === active + 1 && (title(u) + ' ' + (u.titleZh || '') + ' ' + id(u)).toLowerCase().indexOf(query.trim().toLowerCase()) !== -1;
      });
      list.innerHTML = matches.length ? matches.map(function (u) {
        var current = id(selected[active]) === id(u);
        return '<div class="xxgg-ce-row xxgg-ce-option"><span class="xxgg-ce-title">' + esc(title(u)) +
          (u.titleZh && u.titleEn ? '<div class="xxgg-ce-muted">' + esc(u.titleZh) + '</div>' : '') + '</span>' +
          '<button type="button" class="xxgg-ce-btn" data-ce-action="choose" data-unit-id="' + esc(id(u)) + '"' +
          (busy || current ? ' disabled' : '') + '>' + (current ? '已选' : '使用此篇') + '</button></div>';
      }).join('') : '<p class="xxgg-ce-muted">' + (query.trim() ? '没有匹配的篇目' : '此 Part 暂无可选篇目') + '</p>';
      bind('choose', function (event) {
        var chosen = event.currentTarget.getAttribute('data-unit-id');
        selected[active] = units.find(function (u) { return id(u) === chosen; });
        active = selected.findIndex(function (u) { return !u; });
        query = ''; error = ''; render();
      });
    }
    function load(refresh) {
      var job = ++sequence;
      loading = true; error = ''; render();
      var api = W.__xxggServerCompose;
      Promise.resolve().then(function () {
        if (!api || typeof api.listUnits !== 'function') throw new Error('not-ready');
        return api.listUnits(channel, refresh === true);
      }).then(function (rows) {
        if (disposed || sequence !== job) return;
        units = Array.isArray(rows) ? rows.slice() : [];
        if (!prior.length && job === 1) legacy(channel).forEach(function (uid) {
          var unit = units.find(function (u) { return id(u) === String(uid); });
          var part = rank(unit);
          if (part && part <= need && !selected[part - 1]) selected[part - 1] = unit;
        });
        selected = selected.map(function (u) { return units.find(function (candidate) { return id(candidate) === id(u); }) || u; });
        loading = false; render();
      }, function () {
        if (disposed || sequence !== job) return;
        loading = false; units = []; error = '题库加载失败，请点击“刷新题库”重试。'; render();
      });
    }
    async function apply() {
      if (busy || !complete() || typeof options.onApply !== 'function') return;
      busy = true; error = ''; render();
      try {
        var success = await options.onApply(selected.map(id));
        if (success !== true && !disposed) error = '未能应用这份清单，请重试。';
      } catch (e) { if (!disposed) error = '组卷失败，请重试。'; }
      finally { busy = false; render(); }
    }
    load(false);
    return function dispose() { disposed = true; sequence++; root.innerHTML = ''; };
  }
  styles();
  W.__xxggComposePicker = { mount: mount };
})();
