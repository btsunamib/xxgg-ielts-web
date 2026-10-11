/* Shared rules for independently composed web papers. */
(function (root) {
  'use strict';
  function number(value) {
    return value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
      ? null : Number(value);
  }
  function candidate(u, channel) {
    var id = String(u.id || u.unitId || '');
    var pn = String(u.partNo || (u.parts && u.parts[0] && u.parts[0].partNo) || '');
    var match = pn.match(/^(?:part\s*|p)([1-4])$/i);
    if (!id || !match || (u.channel && u.channel !== channel) ||
        u.available === false || u.lockedForOrdinaryUsers === true ||
        u.mixedSelectable === false || (u.entryMode && u.entryMode !== 'exam') ||
        Number(u.partCount) > 1 || (Array.isArray(u.parts) && u.parts.length > 1)) return null;
    var rank = Number(match[1]);
    if (rank > (channel === 'listening' ? 4 : 3)) return null;
    var avg = number(u.averageAccuracy);
    if (avg === null) {
      avg = number(u.avgAccuracy === undefined ? u.avgAcc : u.avgAccuracy);
      if (avg !== null && avg >= 0 && avg <= 1) avg *= 100;
    }
    if (avg !== null && (avg < 0 || avg > 100)) avg = null;
    return { unitId: id, id: id, albumId: u.albumId || '',
      sourcePartId: u.partId || (u.parts && u.parts[0] && u.parts[0].partId) || '',
      titleEn: u.titleEn || u.title || u.subtitle || id, title: u.title || u.titleEn || id,
      titleZh: u.titleZh || null, channel: channel,
      partNo: 'Part ' + rank, partRank: rank, avgPct: avg,
      sevenDayReportTotal: number(u.sevenDayReportTotal),
      catalogDone: u.progressStatus === 'done' || !!u.resultId };
  }
  function shortage(parts, fallback) {
    return { error: 'MIXED_PRACTICE_NOT_ENOUGH_PARTS',
      data: { shortagePartNos: parts, shortagePartLabels: parts.map(function (p) { return 'Part ' + p; }),
        fallbackAvailable: fallback, fallbackMode: 'DIFFICULTY_MATCHED_COMPLETED_PARTS' } };
  }
  function choose(pool, body, rnd) {
    var need = body.channel === 'listening' ? 4 : 3;
    var custom = body.selectionMode === 'custom' || body.selectedUnitIds !== undefined;
    var high = !custom && body.preferHighFrequency === true;
    var difficulty = high || custom ? 'random' : (body.difficulty || 'random');
    if (['easy', 'medium', 'hard', 'random'].indexOf(difficulty) < 0)
      return { error: 'MIXED_PRACTICE_INVALID_DIFFICULTY' };
    var unique = new Map();
    pool.forEach(function (u) { if (!unique.has(u.unitId)) unique.set(u.unitId, u); });
    pool = Array.from(unique.values());
    if (custom) {
      var ids = body.selectedUnitIds;
      if (!Array.isArray(ids) || ids.length !== need || new Set(ids.map(String)).size !== need)
        return { error: 'MIXED_PRACTICE_SELECTION_INVALID' };
      var selected = ids.map(function (id) { return unique.get(String(id)); });
      if (selected.some(function (u) { return !u; }) ||
          new Set(selected.map(function (u) { return u.partRank; })).size !== need)
        return { error: 'MIXED_PRACTICE_SELECTION_INVALID' };
      return { chosen: selected.sort(function (a, b) { return a.partRank - b.partRank; }) };
    }
    function difficultyPool(rows) {
      if (difficulty === 'random') return rows;
      var known = rows.filter(function (u) { return u.avgPct !== null && u.avgPct !== undefined; })
        .sort(function (a, b) { return b.avgPct - a.avgPct || a.unitId.localeCompare(b.unitId); });
      if (!known.length) return [];
      var band = ['easy', 'medium', 'hard'].indexOf(difficulty);
      var start = Math.floor(known.length * band / 3);
      var end = Math.max(start + 1, Math.floor(known.length * (band + 1) / 3));
      var upper = known[start].avgPct, lower = known[Math.min(end, known.length) - 1].avgPct;
      // Equal accuracy cannot distinguish difficulty; keep boundary ties together.
      return known.filter(function (u) { return u.avgPct <= upper && u.avgPct >= lower; });
    }
    var base = [], missing = [], unattemptedMissing = [], groups = [];
    for (var part = 1; part <= need; part++) {
      var eligible = difficultyPool(pool.filter(function (u) { return u.partRank === part; }));
      base.push(eligible);
      if (!eligible.length) missing.push(part);
      var rows = body.onlyUndone ? eligible.filter(function (u) { return !u.done; }) : eligible;
      if (!rows.length && eligible.length) unattemptedMissing.push(part);
      groups.push(rows);
    }
    if (missing.length) return shortage(missing, false);
    if (unattemptedMissing.length && !body.shortageFallbackConfirmed)
      return shortage(unattemptedMissing, true);
    var excluded = new Set((body.excludePartIds || []).map(String));
    var repeats = false;
    var chosen = groups.map(function (rows, i) {
      if (!rows.length) rows = base[i]; // Only after explicit shortage confirmation.
      var alternatives = rows.filter(function (u) {
        return !excluded.has(u.unitId) && !excluded.has(String(u.sourcePartId || ''));
      });
      if (alternatives.length) rows = alternatives;
      else if (excluded.size) repeats = true;
      // Counts are public catalogue data, independent of ranking entitlements.
      var weighted = high ? rows.filter(function (u) { return u.sevenDayReportTotal > 0; }) : [];
      if (!weighted.length) return rows[Math.floor(rnd() * rows.length)];
      var total = weighted.reduce(function (sum, u) { return sum + u.sevenDayReportTotal; }, 0);
      var target = rnd() * total;
      for (var j = 0; j < weighted.length; j++) {
        target -= weighted[j].sevenDayReportTotal;
        if (target < 0) return weighted[j];
      }
      return weighted[weighted.length - 1];
    });
    return { chosen: chosen, warning: repeats ? 'MIXED_PRACTICE_REPEAT_ALLOWED' : null };
  }
  var api = { candidate: candidate, choose: choose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.__xxggComposeRules = api;
})(typeof window === 'undefined' ? null : window);
