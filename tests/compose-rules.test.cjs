const test = require('node:test');
const assert = require('node:assert/strict');
const { candidate, choose } = require('../xxgg-compose-rules');
const make = (id, part, avg = 60, count = 5) => candidate({
  id, channel: 'reading', partNo: `Part ${part}`, averageAccuracy: avg,
  sevenDayReportTotal: count, mixedSelectable: true, entryMode: 'exam'
}, 'reading');
const basic = () => [1,2,3].map(p => make(`u${p}`, p));
test('unavailable, locked, recall, multi-Part, nonstandard and wrong-channel units cannot enter the pool', () => {
  for (const extra of [{ available: false }, { lockedForOrdinaryUsers: true },
    { mixedSelectable: false }, { entryMode: 'memory_link' }, { partCount: 2 },
    { parts: [{}, {}] }, { partNo: 'Part 4' }, { partNo: 'unknown' }, { channel: 'listening' }]) {
    assert.equal(candidate({ id:'bad', channel:'reading', partNo:'Part 1', ...extra }, 'reading'), null);
  }
});
test('high-frequency uses report counts rather than accuracy and handles missing/zero heat', () => {
  const pool = basic(); pool[0] = make('cold-easy', 1, 99, 1); pool.push(make('hot-hard', 1, 10, 100));
  assert.equal(choose(pool, { channel:'reading', preferHighFrequency:true }, () => 0.5).chosen[0].unitId, 'hot-hard');
  pool.forEach(u => u.sevenDayReportTotal = null);
  assert.equal(choose(pool, { channel:'reading', preferHighFrequency:true }, () => 0).chosen.length, 3);
});
test('weighted heat favors popular units without always returning the same paper', () => {
  const pool = basic(); pool[0] = make('cold', 1, 90, 1); pool.push(make('hot', 1, 10, 9));
  let hot = 0, cold = 0;
  for (let n=0; n<1000; n++) {
    const id = choose(pool, { channel:'reading', preferHighFrequency:true }, () => (n + 0.5) / 1000).chosen[0].unitId;
    if (id === 'hot') hot++; else cold++;
  }
  assert.equal(hot, 900); assert.equal(cold, 100);
});
test('difficulty tiers are applied independently to every Part with unknown scores excluded', () => {
  const pool = [1,2,3].flatMap(p => [make(`easy${p}`,p,70), make(`medium${p}`,p,50),
    make(`hard${p}`,p,49.99), make(`unknown${p}`,p,null)]);
  for (const difficulty of ['easy','medium','hard']) {
    assert.deepEqual(choose(pool,{channel:'reading',difficulty},()=>0).chosen.map(u=>u.unitId),
      [1,2,3].map(p=>`${difficulty}${p}`));
  }
  const unknown = basic(); unknown.forEach(u=>u.avgPct=null);
  const short = choose(unknown, { channel:'reading',difficulty:'hard' }, ()=>0);
  assert.deepEqual(short.data.shortagePartNos,[1,2,3]); assert.equal(short.data.fallbackAvailable,false);
});
test('missing Parts fail atomically instead of topping up from another Part', () => {
  const result = choose([make('a',1),make('b',1),make('c',3)],{channel:'reading'},()=>0);
  assert.equal(result.error,'MIXED_PRACTICE_NOT_ENOUGH_PARTS');
  assert.deepEqual(result.data.shortagePartNos,[2]); assert.equal(result.chosen,undefined);
});
test('only-undone requires confirmation before reusing completed units and relaxes only missing Parts', () => {
  const pool = basic(); pool[1].done = true; pool.push({...make('done1',1),done:true});
  const body = { channel:'reading',onlyUndone:true };
  const denied = choose(pool,body,()=>0.999);
  assert.deepEqual(denied.data.shortagePartNos,[2]); assert.equal(denied.data.fallbackAvailable,true);
  const accepted = choose(pool,{...body,shortageFallbackConfirmed:true},()=>0.999);
  assert.deepEqual(accepted.chosen.map(u=>u.unitId),['u1','u2','u3']);
});
test('reshuffle uses alternatives in the same Part and warns when repeating is unavoidable', () => {
  const pool = basic(); pool.push(make('new1',1));
  const result = choose(pool,{channel:'reading',excludePartIds:['u1','u2']},()=>0);
  assert.deepEqual(result.chosen.map(u=>u.unitId),['new1','u2','u3']);
  assert.equal(result.warning,'MIXED_PRACTICE_REPEAT_ALLOWED');
});
test('custom selection ignores random filters, preserves exact IDs and rejects duplicate Parts', () => {
  const pool = basic(); pool.forEach(u=>u.done=true);
  const result = choose(pool,{channel:'reading',selectionMode:'custom',selectedUnitIds:['u3','u1','u2'],
    onlyUndone:true,difficulty:'hard',preferHighFrequency:true},()=>0);
  assert.deepEqual(result.chosen.map(u=>u.unitId),['u1','u2','u3']);
  pool.push(make('another1',1));
  assert.equal(choose(pool,{channel:'reading',selectedUnitIds:['u1','another1','u3']},()=>0).error,
    'MIXED_PRACTICE_SELECTION_INVALID');
});

test('per-Part difficulty tiers work with realistic high reading accuracies and retain boundary ties', () => {
  const pool = [1,2,3].flatMap(p=>[60,60,65,70,75,80].map((avg,i)=>make(`p${p}-${i}`,p,avg)));
  const hard=choose(pool,{channel:'reading',difficulty:'hard'},()=>0);
  const easy=choose(pool,{channel:'reading',difficulty:'easy'},()=>0);
  assert.ok(hard.chosen.every(u=>u.avgPct===60));
  assert.ok(easy.chosen.every(u=>u.avgPct>=75));
  const tied=basic();tied.forEach(u=>u.avgPct=80);
  assert.equal(choose(tied,{channel:'reading',difficulty:'hard'},()=>0).chosen.length,3);
});
